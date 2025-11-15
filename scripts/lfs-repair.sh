#!/bin/bash
# Git LFS Pointer File Repair Script
# Detects and fixes LFS pointer files that weren't properly downloaded

set -e

echo "🔧 Git LFS Repair Tool"
echo "====================="

# Function to check if a file is an LFS pointer
is_lfs_pointer() {
    local file="$1"
    if [ -f "$file" ] && [ $(wc -c < "$file") -lt 300 ]; then
        # Check for LFS pointer signature
        if head -1 "$file" 2>/dev/null | grep -q "version https://git-lfs"; then
            return 0
        fi
    fi
    return 1
}

# Count total LFS files
total_files=$(git lfs ls-files | wc -l)
echo "📊 Total LFS-tracked files: $total_files"

# Detect pointer files
echo ""
echo "🔍 Scanning for pointer files..."
pointer_count=0
pointer_files=""

# Get list of LFS-tracked files
git lfs ls-files | cut -d' ' -f3 | while read -r file; do
    if is_lfs_pointer "$file"; then
        echo "  ❌ Pointer detected: $file"
        pointer_count=$((pointer_count + 1))
        pointer_files="$pointer_files$file\n"
    fi
done > /tmp/lfs-pointers.log 2>&1

# Check if any pointers were found
if [ -s /tmp/lfs-pointers.log ]; then
    pointer_count=$(grep -c "Pointer detected" /tmp/lfs-pointers.log || true)
    
    echo ""
    echo "⚠️  Found $pointer_count pointer file(s)"
    cat /tmp/lfs-pointers.log
    
    echo ""
    echo "🔄 Repairing pointer files..."
    echo "  → Fetching LFS objects..."
    git lfs fetch --all
    
    echo "  → Converting pointers to actual files..."
    git lfs checkout
    
    echo ""
    echo "🔍 Verifying repair..."
    remaining_pointers=0
    git lfs ls-files | cut -d' ' -f3 | while read -r file; do
        if is_lfs_pointer "$file"; then
            echo "  ⚠️  Still a pointer: $file"
            remaining_pointers=$((remaining_pointers + 1))
        fi
    done
    
    if [ $remaining_pointers -eq 0 ]; then
        echo "✅ All pointer files successfully repaired!"
    else
        echo "⚠️  Some files may still need manual intervention"
        echo "   Try running: git lfs pull --include='*'"
    fi
else
    echo "✅ No pointer files found - all LFS files are properly downloaded!"
fi

# Cleanup
rm -f /tmp/lfs-pointers.log

echo ""
echo "📈 LFS Status:"
git lfs status | head -5

echo ""
echo "Done! 🎉"