/**
 * This fixed must-use plugin is injected only into LOCAL WordPress test
 * Durable Objects. It is never added to the pinned WordPress ZIP.
 * No arbitrary PHP, SQL, cache keys, or production REST route is accepted.
 */
export const WORDPRESS_TRANSIENT_PROOF_PHP=String.raw`<?php
if ( ! defined( 'ABSPATH' ) ) { exit; }
add_action( 'rest_api_init', static function () {
    register_rest_route( 'microwp-local/v1', '/transient', array(
        'methods' => 'POST',
        'permission_callback' => static function () {
            return current_user_can( 'manage_options' );
        },
        'callback' => static function ( WP_REST_Request $request ) {
            $operation = $request->get_param( 'operation' );
            $scope = $request->get_param( 'scope' );
            if ( ! in_array( $operation, array( 'set', 'get', 'delete' ), true )
                || ! in_array( $scope, array( 'single', 'site' ), true ) ) {
                return new WP_Error( 'invalid_local_proof', 'Invalid fixed test command', array( 'status' => 400 ) );
            }

            $key = 'microwp_local_transient_' . $scope;
            $value = $request->get_param( 'value' );
            $ttl = $request->get_param( 'ttlSeconds' );
            if ( 'set' === $operation ) {
                if ( ! in_array( $value, array( 'alpha', 'beta' ), true )
                    || ! in_array( $ttl, array( 1, 300 ), true ) ) {
                    return new WP_Error( 'invalid_local_proof', 'Invalid fixed test value', array( 'status' => 400 ) );
                }
                $payload = 'single' === $scope
                    ? array( 'marker' => $value, 'nested' => array( 1, 2 ) )
                    : $value;
                $result = 'single' === $scope
                    ? set_transient( $key, $payload, $ttl )
                    : set_site_transient( $key, $payload, $ttl );
                return rest_ensure_response( array(
                    'backend' => wp_using_ext_object_cache() ? 'external' : 'database',
                    'stored' => (bool) $result,
                ) );
            }
            if ( 'get' === $operation ) {
                $found = 'single' === $scope ? get_transient( $key ) : get_site_transient( $key );
                return rest_ensure_response( array(
                    'backend' => wp_using_ext_object_cache() ? 'external' : 'database',
                    'found' => false !== $found,
                    'value' => false !== $found ? $found : null,
                ) );
            }
            $deleted = 'single' === $scope ? delete_transient( $key ) : delete_site_transient( $key );
            return rest_ensure_response( array(
                'backend' => wp_using_ext_object_cache() ? 'external' : 'database',
                'deleted' => (bool) $deleted,
            ) );
        },
    ) );
} );
`;
