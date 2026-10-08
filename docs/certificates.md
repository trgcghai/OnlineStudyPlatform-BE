# Chứng chỉ số — T4-01

## Cấu trúc module

Mỗi tính năng có một module; các service tách theo trách nhiệm và chỉ được đăng ký tại module sở hữu:

| Module | Trách nhiệm | Service export cho module khác |
| --- | --- | --- |
| `CertificatesModule` | Cấp chứng chỉ, kiểm tra điều kiện, PDF, storage, queue, worker và reconciliation | `CertificateQueueService` |
| `LearningModule` | Quyền học, đọc nội dung học, tiến độ bài/khóa học và xác nhận hoàn thành | `LearningAccessService`, `LearningProgressService`, `CourseProgressService` |
| `QuizzesModule` | Quản lý quiz, làm bài, chấm bài và dọn attempt hết hạn | `QuizzesService` |

Hướng phụ thuộc: `LessonsModule` và `QuizzesModule` import `LearningModule`; `LearningModule` import `CertificatesModule`. Learning không import ngược Lessons/Quizzes. Quyền truy cập học nằm trong `learning/learning-access.service.ts`; controller/service làm quiz nằm và được đăng ký trong Quizzes.

`CourseProgressModule` và `CertificateQueueModule` đã được bỏ. Cấu hình BullMQ nằm trong `CertificatesModule`, publisher nằm trong `certificate-queue.service.ts`, tên queue/job và payload nằm trong `certificate.constants.ts`. Quizzes dùng service tiến độ do Learning export, không đăng ký provider tiến độ lần nữa. API, schema và quy tắc hoàn thành/cấp chứng chỉ giữ nguyên.

## Luồng cấp

- Sau khi lưu tiến độ 100% và `completedAt`, `CourseProgressService` gửi job mà không chặn phản hồi học tập.
- BullMQ dùng job ID theo learner-course, 5 attempts và exponential backoff (5 giây ban đầu).
- Worker kiểm tra lại enrollment, khóa học có bài học, tiến độ xem/hoàn thành của mọi bài học, và attempt `PASSED` đã nộp, `passed=true`, không còn essay chờ chấm cho mọi quiz.
- PostgreSQL advisory lock trong transaction và unique constraint learner-course chống cấp trùng giữa các worker. Bản ghi chỉ được insert sau khi upload PDF thành công. Tên học viên, tên khóa học, ngày cấp và URL được giữ nguyên khi chạy lại.
- Mỗi 5 phút, reconciliation đọc tối đa 100 enrollment hoàn thành chưa có chứng chỉ, dùng cursor để tiếp tục các batch. Job lỗi hoặc mất lúc Redis gián đoạn sẽ được gửi lại.

## Lưu trữ và API

PDF khổ A4 ngang, nền kem, chữ navy, viền vàng mảnh, họa tiết góc và biểu tượng hoàn thành. Tên học viên nổi bật; tên học viên/khóa học tự xuống dòng và điều chỉnh cỡ chữ trong vùng nội dung, không cắt bỏ chữ. Ngày cấp và mã chứng chỉ ở chân trang; không in link verify hoặc thêm hyperlink vào PDF.

Các nhãn và nội dung cố định trên PDF dùng tiếng Anh; ngày cấp hiển thị theo dạng `07 October 2026`, múi giờ `Asia/Ho_Chi_Minh`. PDF dùng font chuẩn Helvetica/Helvetica Bold và Times Bold có sẵn trong `pdf-lib`; không cần thư mục font assets, fontkit, font hệ điều hành hoặc tải font qua mạng.

Theo lựa chọn của người dùng, tên học viên/khóa học tiếng Việt được hiển thị không dấu trên PDF (`Nguyễn` → `Nguyen`, `Đỗ` → `Do`). Đây chỉ là chuyển đổi khi vẽ PDF, không dịch tên khóa học sang tiếng Anh và không sửa tên gốc hay snapshot trong DB/API. Mẫu mới áp dụng khi cấp chứng chỉ mới. PDF đã cấp lưu cố định trong MinIO; đổi mẫu không tự thay file đã cấp hoặc thay snapshot tên/ngày cấp.

Ngày 2026-10-07, theo yêu cầu cập nhật chứng chỉ đã cấp, đã thay PDF của chứng chỉ `ca1b9b1e-8831-4083-86fb-2dad16957294` bằng mẫu tiếng Anh hiện tại. Thao tác bảo trì dùng snapshot gốc, giữ nguyên mã, ngày cấp, URL, object key và toàn bộ bản ghi DB. Bản PDF cũ được sao lưu trong cùng bucket riêng tư tại `template-backups/refresh-44c64c20-0242-4624-a4bc-133d436159b8/ca1b9b1e-8831-4083-86fb-2dad16957294.pdf`; API tải xuống đã được kiểm tra trả đúng file mới. Đây là lần cập nhật được yêu cầu riêng, không thay đổi quy tắc bất biến khi chạy lại luồng cấp chứng chỉ.

Bucket mặc định là `${MINIO_BUCKET}-certificates`, riêng biệt với bucket assets công khai. Có thể cấu hình `CERTIFICATES_BUCKET`; không được đặt trùng `MINIO_BUCKET`. Bucket chứng chỉ không có public-read policy. Object key là `certificates/<certificate UUID>.pdf`.

| API | Quyền | Kết quả |
| --- | --- | --- |
| `GET /learner/certificates` | Learner đang đăng nhập | Danh sách chứng chỉ của chính mình |
| `GET /learner/certificates/:id/download` | Learner sở hữu chứng chỉ | PDF attachment, private/no-store |
| `GET /certificates/:id/verify` | Theo UUID, không cần đăng nhập | Chỉ thông tin trên chứng chỉ: tên, khóa học, ngày cấp |

Các API JSON dùng response envelope chung. Không trả object key hoặc ID tài khoản cho người xác minh. URL tải ổn định lưu trong bản ghi là đường dẫn API; FE gọi qua axiosClient để gửi access token và xử lý refresh.

Không cần cấu hình URL xác minh cho mẫu PDF. API xác minh theo UUID vẫn trả thông tin snapshot theo đường dẫn ở trên.

## Triển khai và kiểm tra

### Video có lượt xem nhưng tiến độ không tăng

Tiến độ khóa học tính bằng số bài đã hoàn thành / tổng số bài. Một bài hoàn thành khi xem đủ ngưỡng `courses.completion_threshold_percent` (mặc định 90%) và đã đạt quiz của bài, nếu có.

Backend dùng `lessons.duration` để giới hạn số giây xem và tính `lesson_progress.watch_ratio`. Nếu thời lượng bằng 0, lượt xem bị giới hạn thành 0 và bài không thể hoàn thành. Luồng import ZIP đọc thời lượng thực từ file video bằng `ffprobe` trước khi lưu bài; lỗi đọc metadata đi theo cơ chế retry của import và không lưu bài video với thời lượng 0. File tạm được dọn sau khi đọc. Docker đã cài FFmpeg/ffprobe; khi chạy BE trực tiếp cần `ffprobe` trong PATH hoặc đặt `FFPROBE_PATH`.

Với bài import cũ có thời lượng 0, cần đọc metadata file đang lưu và bổ sung thời lượng đúng. Cột số giây xem đã bị ghi thành 0 không cho biết vị trí xem cũ. Có thể khôi phục mốc thấp nhất theo bucket 15 giây trong `idempotency_key` của sự kiện `heartbeat`/`paused` nếu sự kiện thuộc đúng học viên, khóa học, bài học và thời lượng khớp file hiện tại. Tính lại tỷ lệ xem và hoàn thành bằng logic backend, sau đó làm mới cache học tập/dashboard. Không suy ra số giây chỉ từ sự kiện `completed`; nếu không có mốc hợp lệ, học viên mở lại player để hệ thống ghi nhận lượt xem tiếp theo.

### Nút xác nhận hoàn thành bài học

Trang học hiển thị icon dấu tích màu xanh và nhãn “Đã hoàn thành” từ trạng thái `lesson_progress.lesson_completed_at`. Bài chưa hoàn thành có nút “Đánh dấu hoàn thành”; nút chờ lượt xem đang gửi lưu xong, hiển thị trạng thái đang xác nhận và lý do nếu chưa đủ điều kiện. Tự hoàn thành theo luồng xem/quiz hiện tại vẫn hoạt động.

`POST /learning/courses/:courseId/lessons/:lessonId/complete` yêu cầu JWT Learner, enrollment, khóa học Published và quyền truy cập bài theo thứ tự học. API không nhận số giây xem từ nút: backend kiểm tra `watched_seconds` đã lưu với `lessons.duration` và ngưỡng hiện tại của khóa học. Nếu có quiz, cần attempt `PASSED`, đã nộp, `passed=true` và `pending_essay_count=0`.

Transaction khóa enrollment và dòng progress, cập nhật timestamp hoàn thành và tính lại `enrollments.progress/completed_at`. Không tăng số giây xem hoặc tạo sự kiện xem giả. Bấm lặp lại giữ timestamp cũ và không thêm sự kiện analytics hoàn thành lần thứ hai. Lần xác nhận mới ghi `learning_analytics_events` với `event_type=completed`, `payload.source=manual_confirmation`. Chỉ kích hoạt queue chứng chỉ sau commit; làm mới cache trước khi phản hồi để frontend lấy được trạng thái mới. Không cần migration thêm.

Kiểm thử API/transaction: `pnpm test:e2e --runInBand --testPathPatterns=lesson-completion`, dùng PostgreSQL thực trong schema kiểm thử riêng.

### Migration và kiểm thử

Production cần chạy migration `1791158400000-create-certificates.ts` bằng quy trình `pnpm migration:run` trước khi khởi động BE mới với `DB_SYNCHRONIZE=false`. Migration có thể revert; bảng có khóa ngoại User/Course và unique learner-course/object key.

Frontend hiển thị chứng chỉ trên `/learner/dashboard`, có trạng thái rỗng/lỗi/đang cấp và tải PDF có auth. Danh sách cập nhật mỗi 10 giây khi vẫn còn khóa học hoàn thành chưa có chứng chỉ, dừng polling sau khi đã có đủ.

Kiểm thử:

- `pnpm test --runInBand`: unit suite backend.
- `pnpm test:e2e --runInBand certificates.e2e-spec`: PostgreSQL/Redis/MinIO thực, cần `.env` BE và `.env` root; tạo schema, queue, bucket mang UUID kiểm thử và dọn sau khi chạy.
- E2E bao gồm quiz chưa đạt/chờ chấm, completion trigger, retry, checks đồng thời, constraint chống trùng, list/download PDF, storage private, role/ownership/UUID, xác minh và snapshot/PDF bất biến khi đổi tên hoặc curriculum.
- FE: `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`.
