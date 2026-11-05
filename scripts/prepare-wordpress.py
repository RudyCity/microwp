#!/usr/bin/env python3
"""Package pinned official WordPress source as a PHP code .bin ZIP plus public static assets.
The .bin extension makes Wrangler import a binary module instead of exposing it as an asset.
"""
from pathlib import Path
import zipfile,hashlib,json
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/"vendor/wordpress/wordpress-7.1.4.zip"
PIN="a147146c159362778ecbbbfb07bb20ddf4e85b130f971c824e656a8f938c5f87"
DEST=ROOT/"generated/wordpress-php.bin"
SQLITE=ROOT/"vendor/wordpress/sqlite-database-integration-3.1.3.zip"
SQLITE_PIN="f6ce35e8419d0b9326221a907627d905e25c2a5ba2afc86492811f14c851efe0"
PUBLIC=ROOT/"public"
ALLOWED={".css",".js",".mjs",".jpg",".jpeg",".png",".gif",".webp",".avif",".ico",".svg",".woff",".woff2",".ttf",".eot",".otf",".txt",".json"}
if not SOURCE.exists():raise SystemExit("Download https://wordpress.org/wordpress-7.1.4.zip into vendor/wordpress/ first")
sha=hashlib.sha256(SOURCE.read_bytes()).hexdigest()
if sha!=PIN:raise SystemExit(f"WordPress archive SHA256 mismatch: {sha}")
if hashlib.sha256(SQLITE.read_bytes()).hexdigest()!=SQLITE_PIN:raise SystemExit("SQLite plugin SHA256 mismatch")
DEST.parent.mkdir(parents=True,exist_ok=True)
php_count=assets=skipped=0
with zipfile.ZipFile(SOURCE) as src,zipfile.ZipFile(DEST,"w",zipfile.ZIP_DEFLATED,compresslevel=7) as core:
    for file in src.infolist():
        if file.is_dir():continue
        if not file.filename.startswith("wordpress/"):raise SystemExit("Unexpected ZIP entry prefix")
        relative=file.filename.removeprefix("wordpress/")
        path=Path(relative)
        if not relative or any(part in ("..",".") for part in path.parts):raise SystemExit("Unsafe ZIP entry")
        if any(part.startswith(".") for part in path.parts):skipped+=1;continue
        if relative in ("wp-config.php","wp-content/debug.log") or path.suffix.lower() in (".sql",".bak",".key",".pem",".phar"):
            skipped+=1;continue
        if path.suffix.lower()==".php":
            core.writestr(relative,src.read(file))
            php_count+=1
        elif path.suffix.lower() in ALLOWED and (relative.startswith(("wp-includes/","wp-admin/","wp-content/")) or relative in ("robots.txt","favicon.ico")):
            target=PUBLIC/path
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes(src.read(file))
            assets+=1
        else:skipped+=1
    with zipfile.ZipFile(SQLITE) as sqlite:
        for pluginfile in sqlite.infolist():
            if pluginfile.is_dir():continue
            if not pluginfile.filename.startswith("sqlite-database-integration/"):raise SystemExit("Unsafe SQLite ZIP path")
            name=pluginfile.filename
            if "/.." in name or "\\" in name:raise SystemExit("Unsafe SQLite path")
            relative="wp-content/plugins/"+name
            if name.endswith(".php"):
                core.writestr(relative,sqlite.read(pluginfile));php_count+=1
            elif name.endswith("/db.copy"):
                core.writestr("wp-content/db.php",sqlite.read(pluginfile));php_count+=1
            elif Path(name).suffix.lower() in ALLOWED:
                target=PUBLIC/relative;target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(sqlite.read(pluginfile));assets+=1
manifest={"version":"7.1.4","official_zip_sha256":sha,"php_files":php_count,"static_assets":assets,"skipped":skipped,"php_archive_bytes":DEST.stat().st_size,"php_archive_sha256":hashlib.sha256(DEST.read_bytes()).hexdigest()}
(DEST.parent/"wordpress-manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
print(json.dumps(manifest,indent=2))
