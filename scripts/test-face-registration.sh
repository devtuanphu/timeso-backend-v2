#!/bin/bash
# ============================================================
#  TEST FACE REGISTRATION — Chạy trên server VPS
#  Usage: bash scripts/test-face-registration.sh
# ============================================================

API_BASE="http://localhost:3000/api"

echo "============================================"
echo "  🧪 TEST FACE REGISTRATION ENDPOINT"
echo "============================================"
echo ""

# ─── Hàm parse JSON đơn giản (không cần jq) ───
parse_json() {
  local key="$1"
  local json="$2"
  echo "$json" | grep -o "\"$key\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

# ─── STEP 1: Đăng nhập ───
echo "━━━ STEP 1: Đăng nhập lấy JWT Token ━━━"
echo ""
read -p "📱 Nhập email hoặc SĐT: " LOGIN_ID
read -s -p "🔑 Nhập mật khẩu: " LOGIN_PASS
echo ""
echo ""

echo "Đang đăng nhập..."
LOGIN_RESULT=$(curl -s -X POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"emailOrPhone\":\"$LOGIN_ID\",\"password\":\"$LOGIN_PASS\",\"appType\":\"OWNER_APP\"}")

TOKEN=$(parse_json "accessToken" "$LOGIN_RESULT")
if [ -z "$TOKEN" ]; then
  TOKEN=$(parse_json "access_token" "$LOGIN_RESULT")
fi

if [ -z "$TOKEN" ]; then
  echo "❌ Đăng nhập thất bại!"
  echo "Response: $LOGIN_RESULT"
  exit 1
fi
echo "✅ Đăng nhập thành công!"
echo "Token: ${TOKEN:0:40}..."
echo ""

# ─── STEP 2: Lấy danh sách Store ───
echo "━━━ STEP 2: Lấy Store ID ━━━"
STORES_RESULT=$(curl -s -X GET "$API_BASE/stores" \
  -H "Authorization: Bearer $TOKEN")

# Hiển thị danh sách store
echo "Stores Response (500 chars): $(echo $STORES_RESULT | head -c 500)"
echo ""

STORE_ID=$(parse_json "id" "$STORES_RESULT")
if [ -z "$STORE_ID" ]; then
  echo "⚠️  Không tìm thấy store nào. Tạo store mới..."
  CREATE_STORE=$(curl -s -X POST "$API_BASE/stores" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Test Store\",\"phone\":\"0900000000\",\"address\":\"123 Test\"}")
  echo "Create store response: $CREATE_STORE"
  STORE_ID=$(parse_json "id" "$CREATE_STORE")
fi

if [ -z "$STORE_ID" ]; then
  read -p "Nhập Store ID thủ công: " STORE_ID
fi

echo "✅ Store ID: $STORE_ID"
echo ""

# ─── STEP 3: Lấy danh sách Employee ───
echo "━━━ STEP 3: Lấy Employee ID ━━━"
EMP_RESULT=$(curl -s -X GET "$API_BASE/stores/$STORE_ID/employees" \
  -H "Authorization: Bearer $TOKEN")

echo "Employees (500 chars): $(echo $EMP_RESULT | head -c 500)"
echo ""

EMPLOYEE_ID=$(parse_json "id" "$EMP_RESULT")
if [ -z "$EMPLOYEE_ID" ]; then
  echo "⚠️  Không tìm thấy nhân viên nào."
  read -p "Nhập Employee Profile ID thủ công: " EMPLOYEE_ID
fi

echo "✅ Employee ID: $EMPLOYEE_ID"
echo ""

# ─── STEP 4: Tạo ảnh test ───
echo "━━━ STEP 4: Tạo ảnh test ━━━"
# Tạo ảnh JPEG nhỏ nhất có thể (1x1 pixel)
# Đây là binary JPEG hợp lệ, base64 encoded
echo "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS
Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ
CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy
MjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEA
AAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIh
MUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JygQ" | base64 -d > /tmp/face_test_1.jpg 2>/dev/null

# Nếu base64 decode thất bại, tạo file nhỏ
if [ ! -s /tmp/face_test_1.jpg ]; then
  # Tải ảnh mẫu từ internet
  curl -s -L -o /tmp/face_test_1.jpg "https://thispersondoesnotexist.com" 2>/dev/null
fi

# Nếu vẫn không có, tạo file dummy
if [ ! -s /tmp/face_test_1.jpg ]; then
  printf '\xff\xd8\xff\xe0\x00\x10JFIF' > /tmp/face_test_1.jpg
  dd if=/dev/urandom bs=1024 count=10 >> /tmp/face_test_1.jpg 2>/dev/null
fi

cp /tmp/face_test_1.jpg /tmp/face_test_2.jpg
cp /tmp/face_test_1.jpg /tmp/face_test_3.jpg
echo "✅ Ảnh test đã tạo:"
ls -la /tmp/face_test_*.jpg
echo ""

# ─── STEP 5: GỌI FACE REGISTRATION (MAIN TEST) ───
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🎯 STEP 5: TEST FACE REGISTRATION API"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "POST $API_BASE/stores/employees/$EMPLOYEE_ID/face-registration"
echo "  storeId=$STORE_ID"
echo "  photos: 3 files"
echo ""

# Dùng curl -v để xem TOÀN BỘ HTTP headers + response
HTTP_CODE=$(curl -s -o /tmp/face_response.txt -w "%{http_code}" \
  -X POST "$API_BASE/stores/employees/$EMPLOYEE_ID/face-registration" \
  -H "Authorization: Bearer $TOKEN" \
  -F "storeId=$STORE_ID" \
  -F "photos=@/tmp/face_test_1.jpg" \
  -F "photos=@/tmp/face_test_2.jpg" \
  -F "photos=@/tmp/face_test_3.jpg")

RESPONSE_BODY=$(cat /tmp/face_response.txt)

echo "━━━ KẾT QUẢ ━━━"
echo ""
echo "📡 HTTP Status Code: $HTTP_CODE"
echo ""
echo "📦 Response Body:"
echo "$RESPONSE_BODY" | head -c 2000
echo ""
echo ""

# Phân tích
echo "━━━ PHÂN TÍCH ━━━"
case "$HTTP_CODE" in
  200|201)
    echo "✅ THÀNH CÔNG! Backend nhận và xử lý được request."
    if echo "$RESPONSE_BODY" | grep -q "faceDescriptors"; then
      echo "   Face descriptors đã được trích xuất thành công."
    elif echo "$RESPONSE_BODY" | grep -q "faces detected"; then
      echo "   ⚠️ Không phát hiện đủ khuôn mặt (ảnh test không có mặt thật — bình thường)"
    fi
    ;;
  400)
    echo "⚠️  BAD REQUEST (400) — Server nhận request nhưng dữ liệu không hợp lệ."
    echo "   Có thể: ảnh test không có khuôn mặt, thiếu field, v.v."
    echo "   → Backend HOẠT ĐỘNG. Lỗi trên app có thể do nguyên nhân khác."
    ;;
  401)
    echo "❌ UNAUTHORIZED (401) — JWT Token không hợp lệ hoặc hết hạn."
    echo "   → Kiểm tra token refresh trên app nhân viên."
    ;;
  404)
    echo "❌ NOT FOUND (404) — Route không tồn tại."
    echo "   → Kiểm tra URL endpoint."
    ;;
  413)
    echo "❌ ENTITY TOO LARGE (413) — File upload quá lớn."
    ;;
  500)
    echo "❌ INTERNAL SERVER ERROR (500) — Backend crash khi xử lý!"
    echo "   → Kiểm tra: pm2 logs time-backend-v2 --lines 30"
    ;;
  502)
    echo "❌ BAD GATEWAY (502) — NestJS không phản hồi."
    ;;
  000|"")
    echo "❌ KHÔNG CÓ RESPONSE — Server không chạy hoặc port sai."
    echo "   → Kiểm tra: pm2 status"
    ;;
  *)
    echo "❓ HTTP $HTTP_CODE — Kiểm tra response body ở trên."
    ;;
esac

echo ""
echo "━━━ PM2 LOGS (20 dòng gần nhất) ━━━"
pm2 logs time-backend-v2 --lines 20 --nostream 2>/dev/null || echo "(không lấy được PM2 logs)"
echo ""

# Cleanup
rm -f /tmp/face_test_*.jpg /tmp/face_response.txt
echo "🧹 Cleanup done."
