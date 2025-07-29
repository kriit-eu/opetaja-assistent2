#!/bin/bash

# Script to list all students with OPPURSTAATUS_K (interrupted) status in TAHVEL
# Usage: ./list_interrupted_students.sh <session_id> [page_size]

# Check arguments
if [ $# -lt 1 ] || [ $# -gt 2 ]; then
    echo "Usage: $0 <session_id> [page_size]"
    echo "Example: $0 abc123def456 100"
    echo "Default page_size is 50"
    exit 1
fi

SESSION_ID=$1
PAGE_SIZE=${2:-50}  # Default to 50 if not provided
BASE_URL="https://test.tahvel.eenet.ee/hois_back"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Fetching all students with OPPURSTAATUS_K (interrupted) status...${NC}"
echo -e "${CYAN}Page size: ${PAGE_SIZE}${NC}\n"

# Initialize variables
PAGE=0
TOTAL_STUDENTS=0
HAS_MORE=true

# Create header for the output
printf "${GREEN}%-15s %-30s %-20s %-15s %-30s${NC}\n" "Personal Code" "Name" "Student Code" "Study Form" "Curriculum"
echo "=================================================================================================="

# Function to fetch and process a page of students
fetch_page() {
    local page=$1
    
    # Make API request
    local response=$(curl -s -X GET \
        "${BASE_URL}/students?status=OPPURSTAATUS_K&size=${PAGE_SIZE}&page=${page}" \
        -H "Cookie: SESSION=${SESSION_ID}" \
        -H "Accept: application/json")
    
    # Check for error
    if echo "$response" | grep -q "error"; then
        echo -e "${RED}Error fetching data:${NC}"
        echo "$response" | jq -r '.message // .error // .'
        return 1
    fi
    
    # Extract student data using jq if available, otherwise use grep/sed
    if command -v jq &> /dev/null; then
        # Parse with jq
        local students=$(echo "$response" | jq -r '.content[] | 
            "\(.person.idcode // "N/A")\t\(.person.fullname // "N/A")\t\(.studentCode // "N/A")\t\(.studyForm // "N/A")\t\(.curriculumVersion.code // "N/A") - \(.curriculumVersion.nameEt // .curriculumVersion.nameEn // "N/A")"')
        
        # Get pagination info
        TOTAL_ELEMENTS=$(echo "$response" | jq -r '.totalElements // 0')
        TOTAL_PAGES=$(echo "$response" | jq -r '.totalPages // 0')
        CURRENT_PAGE=$(echo "$response" | jq -r '.number // 0')
        IS_LAST=$(echo "$response" | jq -r '.last // true')
        
        # Print students
        if [ -n "$students" ]; then
            while IFS=$'\t' read -r idcode name code form curriculum; do
                printf "%-15s %-30s %-20s %-15s %-30s\n" \
                    "${idcode:0:15}" \
                    "${name:0:30}" \
                    "${code:0:20}" \
                    "${form:0:15}" \
                    "${curriculum:0:30}"
                ((TOTAL_STUDENTS++))
            done <<< "$students"
        fi
    else
        # Fallback parsing without jq
        echo -e "${YELLOW}Note: Install 'jq' for better JSON parsing${NC}"
        
        # Extract basic info using grep and sed
        local student_blocks=$(echo "$response" | grep -o '"person":{[^}]*}' | head -20)
        
        while read -r block; do
            if [ -n "$block" ]; then
                local idcode=$(echo "$block" | grep -o '"idcode":"[^"]*"' | cut -d'"' -f4)
                local fullname=$(echo "$block" | grep -o '"fullname":"[^"]*"' | cut -d'"' -f4)
                
                printf "%-15s %-30s %-20s %-15s %-30s\n" \
                    "${idcode:0:15}" \
                    "${fullname:0:30}" \
                    "N/A" \
                    "N/A" \
                    "N/A"
                ((TOTAL_STUDENTS++))
            fi
        done <<< "$student_blocks"
        
        # Check if this is the last page (simple check)
        if [ $(echo "$student_blocks" | wc -l) -lt $PAGE_SIZE ]; then
            IS_LAST="true"
        else
            IS_LAST="false"
        fi
    fi
    
    # Return success
    return 0
}

# Main loop to fetch all pages
while [ "$HAS_MORE" = true ]; do
    echo -e "${CYAN}Fetching page $((PAGE + 1))...${NC}" >&2
    
    if fetch_page $PAGE; then
        if [ "$IS_LAST" = "true" ]; then
            HAS_MORE=false
        else
            ((PAGE++))
        fi
    else
        echo -e "${RED}Failed to fetch page $((PAGE + 1))${NC}"
        exit 1
    fi
done

echo "=================================================================================================="
echo -e "${GREEN}Total interrupted students found: ${TOTAL_STUDENTS}${NC}"

if command -v jq &> /dev/null && [ -n "$TOTAL_PAGES" ]; then
    echo -e "${CYAN}Total pages: ${TOTAL_PAGES}${NC}"
fi

# Optional: Export to CSV
echo -e "\n${YELLOW}Do you want to export the results to CSV? (y/n)${NC}"
read -r EXPORT_CHOICE

if [[ "$EXPORT_CHOICE" =~ ^[Yy]$ ]]; then
    CSV_FILE="interrupted_students_$(date +%Y%m%d_%H%M%S).csv"
    
    # Create CSV header
    echo "Personal Code,Full Name,Student Code,Study Form,Curriculum" > "$CSV_FILE"
    
    # Re-fetch all data and export to CSV
    PAGE=0
    HAS_MORE=true
    
    echo -e "${CYAN}Exporting to ${CSV_FILE}...${NC}"
    
    while [ "$HAS_MORE" = true ]; do
        response=$(curl -s -X GET \
            "${BASE_URL}/students?status=OPPURSTAATUS_K&size=${PAGE_SIZE}&page=${PAGE}" \
            -H "Cookie: SESSION=${SESSION_ID}" \
            -H "Accept: application/json")
        
        if command -v jq &> /dev/null; then
            echo "$response" | jq -r '.content[] | 
                [.person.idcode // "N/A", .person.fullname // "N/A", .studentCode // "N/A", .studyForm // "N/A", (.curriculumVersion.code // "N/A") + " - " + (.curriculumVersion.nameEt // .curriculumVersion.nameEn // "N/A")] | @csv' >> "$CSV_FILE"
            
            IS_LAST=$(echo "$response" | jq -r '.last // true')
        else
            # Simple CSV export without jq
            echo "$response" | grep -o '"idcode":"[^"]*"' | cut -d'"' -f4 >> "$CSV_FILE"
            IS_LAST="true"  # Can't determine properly without jq
        fi
        
        if [ "$IS_LAST" = "true" ]; then
            HAS_MORE=false
        else
            ((PAGE++))
        fi
    done
    
    echo -e "${GREEN}✓ Data exported to ${CSV_FILE}${NC}"
fi

echo -e "\n${GREEN}Done!${NC}"