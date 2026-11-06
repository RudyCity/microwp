/** The opt-in hybrid cache patches only the pinned WordPress cache initializer.
 * The bundled WordPress core cache.php is restored for normal operation.
 * A separate object-cache.php drop-in requires that SAME patched core file,
 * avoiding duplicate function definitions on repeated wp_start_object_cache().
 * Only the microwp_public group persists across requests; WordPress Transients
 * use the normal database fallback, not a request-local transient cache.
 */
export const WORKER_OBJECT_CACHE_PHP = String.raw`<?php
/**
 * microWP opt-in object-cache backend.
 * The patched WordPress wp-includes/cache.php API is included once.
 * ONLY the opt-in microwp_public namespace uses the internal Worker.
 * All other WordPress object-cache groups stay request-local; Transients
 * retain WordPress's database-backed behavior.
 */
class MicroWP_Worker_Object_Cache extends WP_Object_Cache {
    private const GROUP = 'microwp_public';

    private function eligible($group, $key) {
        // Versioned immutable keys only. Stale entries cannot be reused after
        // changes if callers derive the revision from authoritative D1 data.
        return $group === self::GROUP && is_string($key)
            && preg_match('/^[a-z0-9][a-z0-9:_-]{0,160}:v[0-9a-f]{12,64}$/D', $key) === 1;
    }

    private function allowed_value($value, $depth = 0) {
        if ($depth > 12) return false;
        if (is_null($value) || is_scalar($value)) return true;
        if (!is_array($value) || count($value) > 256) return false;
        foreach ($value as $key => $item) {
            if (!is_int($key) && !is_string($key)) return false;
            if (!$this->allowed_value($item, $depth + 1)) return false;
        }
        return true;
    }

    private function rpc($operation, $args = array()) {
        if (!function_exists('post_message_to_js')) return array('ok' => false);
        $request = array_merge(array(
            'version' => 1,
            'op' => $operation,
            'group' => self::GROUP,
        ), $args);
        $json = json_encode($request, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        if (!is_string($json) || strlen($json) > 90000) return array('ok' => false);
        try {
            $answer = post_message_to_js('microwp:object-cache:v1:' . $json);
            $decoded = is_string($answer) ? json_decode($answer, true) : null;
            return is_array($decoded) && isset($decoded['ok']) ? $decoded : array('ok' => false);
        } catch (Throwable $error) {
            // Cache must NEVER stop WordPress rendering or database writes.
            return array('ok' => false);
        }
    }

    private function payload($data) {
        if (!$this->allowed_value($data)) return false;
        $encoded = base64_encode(serialize($data));
        if (strlen($encoded) > 65536) return false;
        return $encoded;
    }

    private function remote_ttl($expire) {
        $seconds = (int) $expire;
        return $seconds > 0 ? min($seconds, 300) : 300;
    }

    public function get($key, $group = 'default', $force = false, &$found = null) {
        $hit = false;
        $local = parent::get($key, $group, $force, $hit);
        if ($hit && !$force) {
            $found = true;
            return $local;
        }
        $found = $hit;
        if (!$this->eligible($group, $key)) return $local;
        $result = $this->rpc('get', array('key' => $key));
        if (empty($result['ok']) || empty($result['found']) || !isset($result['value'])
            || !is_string($result['value'])) return $local;
        $raw = base64_decode($result['value'], true);
        if ($raw === false) return $local;
        $value = @unserialize($raw, array('allowed_classes' => false));
        if (!$this->allowed_value($value)) return $local;
        parent::set($key, $value, $group);
        $found = true;
        return $value;
    }

    public function set($key, $data, $group = 'default', $expire = 0) {
        $stored = parent::set($key, $data, $group, $expire);
        if ($stored && $this->eligible($group, $key)) {
            $payload = $this->payload($data);
            if (is_string($payload)) {
                $this->rpc('set', array(
                    'key' => $key, 'value' => $payload,
                    'ttlSeconds' => $this->remote_ttl($expire),
                ));
            } else {
                // A value that is not safe to persist must invalidate an older
                // remote copy, never quietly preserve a stale serialized object.
                $this->rpc('del', array('key' => $key));
            }
        }
        return $stored;
    }

    public function add($key, $data, $group = 'default', $expire = 0) {
        if (!$this->eligible($group, $key)) return parent::add($key, $data, $group, $expire);
        $payload = $this->payload($data);
        if (!is_string($payload)) return parent::add($key, $data, $group, $expire);
        $remote = $this->rpc('add', array(
            'key' => $key, 'value' => $payload,
            'ttlSeconds' => $this->remote_ttl($expire),
        ));
        if (!empty($remote['ok'])) {
            if (empty($remote['stored'])) return false;
            return parent::set($key, $data, $group, $expire);
        }
        return parent::add($key, $data, $group, $expire);
    }

    public function replace($key, $data, $group = 'default', $expire = 0) {
        $stored = parent::replace($key, $data, $group, $expire);
        if ($stored && $this->eligible($group, $key)) {
            $payload = $this->payload($data);
            if (is_string($payload)) $this->rpc('set', array(
                'key' => $key, 'value' => $payload,
                'ttlSeconds' => $this->remote_ttl($expire),
            ));
            else $this->rpc('del', array('key' => $key));
        }
        return $stored;
    }

    public function delete($key, $group = 'default', $deprecated = false) {
        $local = parent::delete($key, $group, $deprecated);
        if (!$this->eligible($group, $key)) return $local;
        $result = $this->rpc('del', array('key' => $key));
        return $local || (!empty($result['ok']) && !empty($result['deleted']));
    }

    public function flush() {
        $this->rpc('flushGroup');
        return parent::flush();
    }

    public function flush_group($group) {
        if ($group === self::GROUP) $this->rpc('flushGroup');
        return parent::flush_group($group);
    }

    public function incr($key, $offset = 1, $group = 'default') {
        $result = parent::incr($key, $offset, $group);
        // No native decrement semantics exist yet for Worker-only cache.
        // Clear remote copy rather than allowing stale numeric values.
        if ($this->eligible($group, $key)) $this->rpc('del', array('key' => $key));
        return $result;
    }

    public function decr($key, $offset = 1, $group = 'default') {
        $result = parent::decr($key, $offset, $group);
        if ($this->eligible($group, $key)) $this->rpc('del', array('key' => $key));
        return $result;
    }
}
`;
const ORIGINAL_INITIALIZER="$GLOBALS['wp_object_cache'] = new WP_Object_Cache();";
const HYBRID_INITIALIZER=`$GLOBALS['wp_object_cache'] = new MicroWP_Worker_Object_Cache();
	// Only microwp_public is persistent; WordPress transients must stay database-backed.
	if ( function_exists( 'wp_using_ext_object_cache' ) ) {
		wp_using_ext_object_cache( false );
	}`;

export interface HybridWordPressCacheFiles {
  coreCachePhp:string;
  objectCacheDropinPhp:string;
}
export function buildWorkerObjectCacheDropin(coreCachePhp:string):HybridWordPressCacheFiles {
 if(!coreCachePhp.startsWith("<?php") ||
    coreCachePhp.split(ORIGINAL_INITIALIZER).length!==2 ||
    !coreCachePhp.includes("function wp_cache_init()") ||
    !coreCachePhp.includes("function wp_cache_supports(")) {
  throw Error("Pinned WordPress object cache API unexpected; refuse opt-in");
 }
 return {
  coreCachePhp:coreCachePhp.replace(ORIGINAL_INITIALIZER,HYBRID_INITIALIZER),
  objectCacheDropinPhp:String.raw`<?php
require_once ABSPATH . WPINC . '/cache.php';
`+
    WORKER_OBJECT_CACHE_PHP.replace(/^<\?php\s*/, "")
 };
}
