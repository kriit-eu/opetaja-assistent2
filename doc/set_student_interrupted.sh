#!/bin/bash

# Script to set a student's status to OPPURSTAATUS_K (interrupted) in TAHVEL
# Usage: ./set_student_interrupted.sh <personal_code> <session_id>

# Check arguments
if [ $# -ne 2 ]; then
    echo "Usage: $0 <personal_code> <session_id>"
    echo "Example: $0 39901011234 abc123def456"
    exit 1
fi

PERSONAL_CODE=$1
SESSION_ID=$2
BASE_URL="https://test.tahvel.eenet.ee/hois_back"
CURRENT_DATE=$(date +%Y-%m-%d)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting process to set student with personal code ${PERSONAL_CODE} to OPPURSTAATUS_K${NC}"

# Step 1: Search for the student by personal code
echo -e "\n${GREEN}Step 1: Searching for student...${NC}"
STUDENT_SEARCH_RESPONSE=$(curl -s -X GET \
  "${BASE_URL}/students?idcode=${PERSONAL_CODE}&size=10&page=0" \
  -H "Cookie: SESSION=${SESSION_ID}" \
  -H "Accept: application/json")

# Extract student ID from response
STUDENT_ID=$(echo "$STUDENT_SEARCH_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$STUDENT_ID" ]; then
    echo -e "${RED}Error: Student not found with personal code ${PERSONAL_CODE}${NC}"
    exit 1
fi

echo -e "Found student with ID: ${STUDENT_ID}"

# Step 2: Create a new directive
echo -e "\n${GREEN}Step 2: Creating new KASKKIRI_KEKSMAT directive...${NC}"
CREATE_DIRECTIVE_RESPONSE=$(curl -s -X POST \
  "${BASE_URL}/directives" \
  -H "Cookie: SESSION=${SESSION_ID}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "type": "KASKKIRI_KEKSMAT",
    "isHigher": false,
    "isVocational": true,
    "headline": "Kumulatiivne eksmatrikuleerimine - '${CURRENT_DATE}'",
    "addInfo": "Õpilase staatus muudetud katkestatuks",
    "students": []
  }')

# Extract directive ID
DIRECTIVE_ID=$(echo "$CREATE_DIRECTIVE_RESPONSE" | grep -o '"id":[0-9]*' | cut -d: -f2)

if [ -z "$DIRECTIVE_ID" ]; then
    echo -e "${RED}Error: Failed to create directive${NC}"
    echo "Response: $CREATE_DIRECTIVE_RESPONSE"
    exit 1
fi

echo -e "Created directive with ID: ${DIRECTIVE_ID}"

# Step 3: Get directive data to find current version
echo -e "\n${GREEN}Step 3: Getting directive details...${NC}"
DIRECTIVE_DATA_RESPONSE=$(curl -s -X GET \
  "${BASE_URL}/directives/${DIRECTIVE_ID}" \
  -H "Cookie: SESSION=${SESSION_ID}" \
  -H "Accept: application/json")

VERSION=$(echo "$DIRECTIVE_DATA_RESPONSE" | grep -o '"version":[0-9]*' | cut -d: -f2)

if [ -z "$VERSION" ]; then
    echo -e "${RED}Error: Failed to get directive version${NC}"
    exit 1
fi

# Step 4: Add student to directive
echo -e "\n${GREEN}Step 4: Adding student to directive...${NC}"
UPDATE_DIRECTIVE_RESPONSE=$(curl -s -X PUT \
  "${BASE_URL}/directives/${DIRECTIVE_ID}" \
  -H "Cookie: SESSION=${SESSION_ID}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "type": "KASKKIRI_KEKSMAT",
    "isHigher": false,
    "isVocational": true,
    "headline": "Kumulatiivne eksmatrikuleerimine - '${CURRENT_DATE}'",
    "students": [{
      "student": '${STUDENT_ID}',
      "reason": "EKSMAT_POHJUS_A",
      "startDate": "'${CURRENT_DATE}'",
      "addInfo": "Õpilase staatus muudetud katkestatuks automaatselt"
    }],
    "version": '${VERSION}'
  }')

# Check if update was successful
if echo "$UPDATE_DIRECTIVE_RESPONSE" | grep -q "error"; then
    echo -e "${RED}Error: Failed to add student to directive${NC}"
    echo "Response: $UPDATE_DIRECTIVE_RESPONSE"
    exit 1
fi

echo -e "Student added to directive successfully"

# Step 5: Send directive to confirmation
echo -e "\n${GREEN}Step 5: Sending directive to confirmation...${NC}"
SEND_TO_CONFIRM_RESPONSE=$(curl -s -X PUT \
  "${BASE_URL}/directives/sendtoconfirm/${DIRECTIVE_ID}?withoutSendingSystem=true" \
  -H "Cookie: SESSION=${SESSION_ID}" \
  -H "Accept: application/json")

# Check for errors
if echo "$SEND_TO_CONFIRM_RESPONSE" | grep -q "error"; then
    echo -e "${RED}Error: Failed to send directive to confirmation${NC}"
    echo "Response: $SEND_TO_CONFIRM_RESPONSE"
    exit 1
fi

echo -e "Directive sent to confirmation"

# Step 6: Confirm the directive
echo -e "\n${GREEN}Step 6: Confirming directive...${NC}"
DIRECTIVE_NR="KEKSMAT-$(date +%Y%m%d)-${DIRECTIVE_ID}"

CONFIRM_RESPONSE=$(curl -s -X PUT \
  "${BASE_URL}/directives/confirm/${DIRECTIVE_ID}" \
  -H "Cookie: SESSION=${SESSION_ID}" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{
    "directiveNr": "'${DIRECTIVE_NR}'",
    "confirmDate": "'${CURRENT_DATE}'"
  }')

# Check if confirmation was successful
if echo "$CONFIRM_RESPONSE" | grep -q "error"; then
    echo -e "${RED}Error: Failed to confirm directive${NC}"
    echo "Response: $CONFIRM_RESPONSE"
    exit 1
fi

echo -e "${GREEN}✓ Directive confirmed successfully!${NC}"

# Step 7: Verify student status
echo -e "\n${GREEN}Step 7: Verifying student status...${NC}"
sleep 2  # Wait for status update to process

STUDENT_STATUS_RESPONSE=$(curl -s -X GET \
  "${BASE_URL}/students/${STUDENT_ID}" \
  -H "Cookie: SESSION=${SESSION_ID}" \
  -H "Accept: application/json")

if echo "$STUDENT_STATUS_RESPONSE" | grep -q "OPPURSTAATUS_K"; then
    echo -e "${GREEN}✓ Success! Student status has been changed to OPPURSTAATUS_K (interrupted)${NC}"
    echo -e "Directive ID: ${DIRECTIVE_ID}"
    echo -e "Directive Number: ${DIRECTIVE_NR}"
else
    echo -e "${YELLOW}Warning: Could not verify status change. Please check manually.${NC}"
fi

echo -e "\n${GREEN}Process completed!${NC}"⏎
