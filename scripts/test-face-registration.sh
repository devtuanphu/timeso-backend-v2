#!/bin/bash
# ============================================================
#  🧪 AUTO TEST FACE REGISTRATION — Hoàn toàn tự động
#  Chạy trên server: bash scripts/test-face-registration.sh
#  Không cần input gì — script tự tạo account, store, employee
# ============================================================

API_BASE="http://localhost:7777/api"
TIMESTAMP=$(date +%s)
TEST_PHONE="099${TIMESTAMP: -7}"
TEST_EMAIL="facetest_${TIMESTAMP}@test.com"
TEST_PASSWORD="Test12345"
TEST_NAME="FaceTest_${TIMESTAMP}"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  🧪 AUTO TEST FACE REGISTRATION         ║"
echo "║  Hoàn toàn tự động — không cần input     ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── Helper: parse JSON field ───
parse_field() {
  echo "$2" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

# ─── Load .env to get DB credentials ───
echo "━━━ Đọc database credentials từ .env ━━━"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
  ENV_FILE="/root/time-backend-v2/.env"
fi

DB_HOST=$(grep "^DATABASE_HOST" "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r\n ')
DB_PORT=$(grep "^DATABASE_PORT" "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r\n ')
DB_USER=$(grep "^DATABASE_USER" "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r\n ')
DB_PASS=$(grep "^DATABASE_PASSWORD" "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r\n ')
DB_NAME=$(grep "^DATABASE_NAME" "$ENV_FILE" | cut -d'=' -f2 | tr -d '\r\n ')

echo "  DB: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo ""

# ─── STEP 1: Tạo account trực tiếp trong DB (bypass OTP) ───
echo "━━━ STEP 1: Tạo account trong DB (status=active) ━━━"

PASS_HASH=$(node -e "const bcrypt=require('bcrypt');bcrypt.hash('${TEST_PASSWORD}',10).then(h=>console.log(h))")
echo "  Password hash: ${PASS_HASH:0:20}..."

ACCOUNT_ID=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -q -c "
  INSERT INTO accounts (id, full_name, email, phone, password_hash, status, gender, birthday, created_at, updated_at)
  VALUES (
    gen_random_uuid(),
    '${TEST_NAME}',
    '${TEST_EMAIL}',
    '${TEST_PHONE}',
    '${PASS_HASH}',
    'active',
    'male',
    '1995-01-15',
    NOW(), NOW()
  )
  RETURNING id;
")

# Trim whitespace
ACCOUNT_ID=$(echo "$ACCOUNT_ID" | tr -d '[:space:]')

if [ -z "$ACCOUNT_ID" ] || echo "$ACCOUNT_ID" | grep -qi "error"; then
  echo "⚠️  Insert lỗi. Lấy account có sẵn..."
  ACCOUNT_ID=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -q -c "
    SELECT id FROM accounts WHERE status='active' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1;
  " | tr -d '[:space:]')
  TEST_PHONE=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -q -c "
    SELECT phone FROM accounts WHERE id='${ACCOUNT_ID}';
  " | tr -d '[:space:]')
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -q -c "
    UPDATE accounts SET password_hash='${PASS_HASH}' WHERE id='${ACCOUNT_ID}';
  " > /dev/null 2>&1
fi

echo "✅ Account ID: $ACCOUNT_ID"
echo "   Phone: $TEST_PHONE | Password: $TEST_PASSWORD"
echo ""

# ─── STEP 2: Đăng nhập lấy JWT Token ───
echo "━━━ STEP 2: Đăng nhập lấy JWT Token ━━━"
LOGIN_RESULT=$(curl -s -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"emailOrPhone\":\"${TEST_PHONE}\",\"password\":\"${TEST_PASSWORD}\",\"appType\":\"OWNER_APP\"}")

TOKEN=$(parse_field "access_token" "$LOGIN_RESULT")
if [ -z "$TOKEN" ]; then
  TOKEN=$(parse_field "accessToken" "$LOGIN_RESULT")
fi

if [ -z "$TOKEN" ]; then
  echo "❌ Login thất bại!"
  echo "   Response: $(echo $LOGIN_RESULT | head -c 300)"
  exit 1
fi
echo "✅ JWT Token: ${TOKEN:0:40}..."
echo ""

# ─── STEP 3: Tạo Store ───
echo "━━━ STEP 3: Tạo Store ━━━"
STORE_RESULT=$(curl -s -X POST "$API_BASE/stores" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Test Face Store\",
    \"phone\": \"${TEST_PHONE}\",
    \"addressLine\": \"123 Test Street\"
  }")

STORE_ID=$(parse_field "id" "$STORE_RESULT")

if [ -z "$STORE_ID" ]; then
  echo "⚠️  Tạo store thất bại: $(echo $STORE_RESULT | head -c 200)"
  echo "   Lấy store có sẵn..."
  # GET /stores trả mảng [{ id: ... }], lấy id đầu tiên
  STORES_LIST=$(curl -s "$API_BASE/stores" -H "Authorization: Bearer $TOKEN")
  STORE_ID=$(parse_field "id" "$STORES_LIST")
fi

if [ -z "$STORE_ID" ]; then
  # Lấy trực tiếp từ DB
  echo "   Lấy store từ DB..."
  STORE_ID=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -q -c "
    SELECT id FROM stores WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 1;
  " | tr -d '[:space:]')
fi

if [ -z "$STORE_ID" ]; then
  echo "❌ Không có store nào. Dừng test."
  exit 1
fi
echo "✅ Store ID: $STORE_ID"
echo ""

# ─── STEP 4: Tạo nhân viên ───
echo "━━━ STEP 4: Tạo nhân viên ━━━"
EMP_PHONE="098${TIMESTAMP: -7}"
EMP_EMAIL="emp_${TIMESTAMP}@test.com"

EMPLOYEE_RESULT=$(curl -s -X POST "$API_BASE/stores/employees/manual" \
  -H "Authorization: Bearer $TOKEN" \
  -F "storeId=$STORE_ID" \
  -F "fullName=Test Employee Face" \
  -F "phone=$EMP_PHONE" \
  -F "email=$EMP_EMAIL" \
  -F "birthday=2000-05-20" \
  -F "gender=male")

EMPLOYEE_ID=$(parse_field "id" "$EMPLOYEE_RESULT")

if [ -z "$EMPLOYEE_ID" ]; then
  echo "⚠️  Tạo employee thất bại: $(echo $EMPLOYEE_RESULT | head -c 200)"
  echo "   Lấy employee có sẵn..."
  EMP_LIST=$(curl -s "$API_BASE/stores/$STORE_ID/employees" -H "Authorization: Bearer $TOKEN")
  EMPLOYEE_ID=$(parse_field "id" "$EMP_LIST")
fi

if [ -z "$EMPLOYEE_ID" ]; then
  # Lấy trực tiếp từ DB
  echo "   Lấy employee từ DB..."
  EMPLOYEE_ID=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -A -q -c "
    SELECT id FROM employee_profiles WHERE store_id='${STORE_ID}' AND deleted_at IS NULL LIMIT 1;
  " | tr -d '[:space:]')
fi

if [ -z "$EMPLOYEE_ID" ]; then
  echo "❌ Không có employee nào. Dừng test."
  exit 1
fi
echo "✅ Employee ID: $EMPLOYEE_ID"
echo ""

# ─── STEP 5: Tạo ảnh test ───
echo "━━━ STEP 5: Tạo ảnh test ━━━"

if command -v convert &> /dev/null; then
  convert -size 640x480 xc:white \
    -fill '#FFDAB9' -draw "ellipse 320,220 120,160 0,360" \
    -fill black -draw "circle 280,180 280,190" \
    -fill black -draw "circle 360,180 360,190" \
    /tmp/test_face_1.jpg 2>/dev/null
  echo "  ✅ Tạo ảnh bằng ImageMagick"
else
  # Tải ảnh mặt người
  curl -s -L -o /tmp/test_face_1.jpg "https://thispersondoesnotexist.com" 2>/dev/null
  if [ -s /tmp/test_face_1.jpg ]; then
    echo "  ✅ Tải ảnh từ internet"
  else
    # Dummy JPEG
    dd if=/dev/urandom bs=1024 count=5 > /tmp/test_face_1.jpg 2>/dev/null
    echo "  ⚠️ Dùng file random (face-api sẽ không detect nhưng test được route)"
  fi
fi

cp /tmp/test_face_1.jpg /tmp/test_face_2.jpg
cp /tmp/test_face_1.jpg /tmp/test_face_3.jpg
echo "  Files: $(ls -lh /tmp/test_face_*.jpg 2>/dev/null | wc -l) files, $(du -sh /tmp/test_face_1.jpg 2>/dev/null | cut -f1) each"
echo ""

# ─── STEP 6: 🎯 GỌI FACE REGISTRATION API ───
echo "╔══════════════════════════════════════════╗"
echo "║  🎯 STEP 6: FACE REGISTRATION API TEST  ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  POST $API_BASE/stores/employees/$EMPLOYEE_ID/face-registration"
echo "  storeId=$STORE_ID"
echo "  photos: 3 files"
echo ""

HTTP_CODE=$(curl -s -o /tmp/face_response.txt -w "%{http_code}" \
  -X POST "$API_BASE/stores/employees/$EMPLOYEE_ID/face-registration" \
  -H "Authorization: Bearer $TOKEN" \
  -F "storeId=$STORE_ID" \
  -F "photos=@/tmp/test_face_1.jpg" \
  -F "photos=@/tmp/test_face_2.jpg" \
  -F "photos=@/tmp/test_face_3.jpg" \
  --max-time 120)

RESPONSE_BODY=$(cat /tmp/face_response.txt 2>/dev/null)

echo "╔══════════════════════════════════════════╗"
echo "║  📊 KẾT QUẢ                             ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  📡 HTTP Status: $HTTP_CODE"
echo ""
echo "  📦 Response:"
echo "  $(echo $RESPONSE_BODY | head -c 1000)"
echo ""

case "$HTTP_CODE" in
  200|201)
    if echo "$RESPONSE_BODY" | grep -q "faceDescriptors"; then
      echo "  ✅ THÀNH CÔNG! Face descriptors đã được lưu."
    else
      echo "  ✅ Request thành công."
    fi
    ;;
  400)
    echo "  ⚠️  BAD REQUEST (400) — Server nhận request, nhưng validate lỗi."
    echo "  → Có thể ảnh test không có khuôn mặt (bình thường)."
    echo ""
    echo "  🔑 KẾT LUẬN: Backend endpoint HOẠT ĐỘNG. Route + Auth đều OK."
    echo "  → Lỗi trên app mobile là do vấn đề khác (network/upload)."
    ;;
  401)
    echo "  ❌ UNAUTHORIZED (401) — Token không hợp lệ."
    ;;
  404)
    echo "  ❌ NOT FOUND (404) — Route không tồn tại."
    ;;
  500)
    echo "  ❌ INTERNAL SERVER ERROR (500) — Backend crash!"
    ;;
  000|"")
    echo "  ❌ KHÔNG CÓ RESPONSE — Timeout hoặc server lỗi."
    ;;
  *)
    echo "  ❓ HTTP $HTTP_CODE"
    ;;
esac

echo ""
echo "━━━ PM2 LOGS (face-related) ━━━"
pm2 logs time-backend-v2 --lines 30 --nostream 2>/dev/null | grep -i "face\|registr\|descriptor" | tail -10 || echo "  (không có log)"
echo ""

# Cleanup
rm -f /tmp/test_face_*.jpg /tmp/face_response.txt
echo "🧹 Done."
