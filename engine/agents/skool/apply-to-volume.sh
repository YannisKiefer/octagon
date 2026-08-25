#!/usr/bin/env bash
# apply-to-volume.sh
# Run this once EcomBrain volume is responsive.
# Copies the 3 new scripts to the correct location and patches leads-13.md.

set -euo pipefail

WORKSPACE="/Users/yanniskiefer/clawd-workspace/skool-whop-team"
TARGET_SRC="/Users/yanniskiefer/clawd/brain/skool-whop-team/src"
TARGET_SHARED="/Users/yanniskiefer/clawd/brain/skool-whop-team/shared"
TARGET_DATA="/Users/yanniskiefer/clawd/brain/skool-whop-team/data"
LEADS_FILE="$TARGET_SHARED/2026-03-08-leads-13.md"

echo "==> Copying scripts..."
mkdir -p "$TARGET_SRC"
cp "$WORKSPACE/src/skool-scout.py"      "$TARGET_SRC/skool-scout.py"
cp "$WORKSPACE/src/skool-joiner.py"     "$TARGET_SRC/skool-joiner.py"
cp "$WORKSPACE/src/skool-dm-auto.py"   "$TARGET_SRC/skool-dm-auto.py"
cp "$WORKSPACE/src/extract-cookies.py" "$TARGET_SRC/extract-cookies.py"
# Also copy queue/joined data if they have content
[ -s "$WORKSPACE/data/queue.json" ] && cp "$WORKSPACE/data/queue.json" "$TARGET_DATA/queue.json" && echo "    Copied queue.json"
[ -s "$WORKSPACE/data/joined.json" ] && cp "$WORKSPACE/data/joined.json" "$TARGET_DATA/joined.json" && echo "    Copied joined.json"
echo "    Done."

echo "==> Creating data dir if needed..."
mkdir -p "$TARGET_DATA"

echo "==> Patching leads-13.md..."
# Use Python for reliable in-place patching
python3 << 'PYEOF'
import re, sys

path = "/Users/yanniskiefer/clawd/brain/skool-whop-team/shared/2026-03-08-leads-13.md"

try:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
except Exception as e:
    print(f"ERROR reading {path}: {e}")
    sys.exit(1)

# Find and replace the easy-ecommerce-academy-8812 block.
# The block ends at the next "---" separator or end of file.
# We detect it by the slug line and replace through the SKIP NOTE.

old_pattern = re.compile(
    r'(###[^\n]*easy.ecommerce.academy[^\n]*\n)'  # heading
    r'.*?'                                          # everything in between
    r'(\*\*SKIP\*\*.*?)(?=\n---|\Z)',              # SKIP note to next separator
    re.DOTALL | re.IGNORECASE
)

new_dm_block = '''**Language:** EN
**Tier:** T3
**Members:** 508
**Score:** 60
**Owner:** unknown
**DM:**

easy ecommerce

508 members learning ecommerce with cash on delivery payment.

built ecombrain. it connects every tool their stores already use and acts automatically. finds where revenue is leaking without them touching anything.

founding partner. 30% locked. 5% converts = $1.1k/mo.

your read on whether it fits?

Yannis, EcomBrain'''

def replacer(m):
    heading = m.group(1)
    return heading + new_dm_block

new_content, count = re.subn(old_pattern, replacer, content)

if count == 0:
    # Fallback: simpler search for the SKIP block near easy-ecommerce
    idx = content.lower().find("easy-ecommerce-academy")
    if idx == -1:
        print("WARNING: easy-ecommerce-academy block not found in leads-13.md")
        print("File not modified.")
        sys.exit(0)
    # Find the heading before idx
    block_start = content.rfind("\n###", 0, idx)
    if block_start == -1:
        block_start = 0
    # Find end of block (next --- or EOF)
    block_end = content.find("\n---", idx)
    if block_end == -1:
        block_end = len(content)
    heading_line = content[block_start:content.find("\n", block_start + 1) + 1]
    new_content = content[:block_start + 1] + heading_line.lstrip("\n") + new_dm_block + content[block_end:]
    count = 1

with open(path, "w", encoding="utf-8") as f:
    f.write(new_content)

print(f"Patched {count} block(s) in {path}")
PYEOF

echo "==> All done."
echo ""
echo "Next steps:"
echo "  1. Install playwright if not already: pip3 install playwright && playwright install chromium"
echo "  2. Test the scout:"
echo "     python3 $TARGET_SRC/skool-scout.py --test --keyword dropshipping --limit 5"
echo "  3. Run full scout (daily):"
echo "     python3 $TARGET_SRC/skool-scout.py"
echo "  4. Run joiner (daily, after scout):"
echo "     python3 $TARGET_SRC/skool-joiner.py"
echo "  5. Run DM sender (daily, 24h after joining):"
echo "     python3 $TARGET_SRC/skool-dm-auto.py"
