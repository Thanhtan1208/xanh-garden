# Vận chuyển, thanh toán và đơn hàng

## Phí vận chuyển
- Giao tiêu chuẩn: 30.000 ₫. Miễn phí vận chuyển cho đơn có giá trị hàng từ 500.000 ₫ (tính trên tiền hàng trước khi giảm giá, nên dùng voucher không làm mất miễn phí vận chuyển).
- Giao nhanh: 50.000 ₫ (không áp dụng miễn phí vận chuyển).
- Cửa hàng giao hàng toàn quốc.

## Phương thức thanh toán
- **Thanh toán khi nhận hàng (COD)**: chỉ áp dụng cho đơn có tiền hàng từ 1.000.000 ₫ trở xuống.
- **Chuyển khoản QR (SePay/VietQR)**: hệ thống hiện mã QR và nội dung chuyển khoản. Khách quét mã chuyển đúng số tiền, đúng nội dung; hệ thống tự ghi nhận khi tiền về. Cần chuyển trong 30 phút, quá hạn đơn sẽ tự hủy và hoàn kho. Đơn có tiền hàng trên 1.000.000 ₫ bắt buộc dùng chuyển khoản.
- Lỡ chuyển thiếu: chuyển bù phần còn lại với **cùng nội dung chuyển khoản** trong thời hạn, hệ thống tự cộng dồn và xác nhận khi đủ tiền. Nếu đơn bị hủy khi mới chuyển một phần, cửa hàng sẽ hoàn lại số tiền đã nhận.
- Chuyển thừa hoặc sai nội dung: khách gửi khiếu nại trong trang Góp ý kèm mã đơn để cửa hàng xử lý.

## Giới hạn đơn hàng
- Mỗi sản phẩm tối đa 20 cái trong một đơn.
- Mỗi đơn tối đa 50.000.000 ₫ (tiền hàng cộng phí vận chuyển). Đơn lớn hơn cần tách thành nhiều đơn.
- Mỗi tài khoản có tối đa 3 đơn đang chờ xác nhận hoặc chờ thanh toán cùng lúc.
- Địa chỉ giao hàng: lưu tối đa 10 địa chỉ, có thể đặt mặc định.

## Đơn hàng trên 1 triệu
Đơn có giá trị hàng trên 1.000.000 ₫ phải thanh toán chuyển khoản QR (không áp dụng COD). Sau khi đặt, khách quét mã QR và chuyển đúng số tiền, đúng nội dung trong 30 phút. Khi ngân hàng báo tiền về, hệ thống (qua webhook SePay) tự ghi nhận thanh toán và **tự xác nhận đơn**, đồng thời gửi email thông tin đơn cho khách. Quá 30 phút chưa nhận được tiền thì đơn tự hủy và hàng được trả về kho. Không cần nhập mã xác nhận nào.

## Trạng thái đơn hàng
1. **Chờ thanh toán** (chỉ đơn trên 1 triệu): chờ khách chuyển khoản; tiền về là đơn tự được xác nhận.
2. **Chờ xác nhận**: chờ cửa hàng xác nhận (đơn chuyển khoản phải nhận được tiền trước).
3. **Đã xác nhận**: cửa hàng đang chuẩn bị hàng.
4. **Đang giao**: nếu giao không thành công (khách không nhận hàng, không liên lạc được) thì đơn bị hủy, hàng hoàn về kho; đơn đã chuyển khoản được cửa hàng hoàn tiền.
5. **Đã giao**: khách đã nhận hàng; từ lúc này khách mới đánh giá được sản phẩm.
6. **Đã hủy**: hàng được hoàn lại kho; voucher đã dùng được trả về ví nếu còn hạn.

## Hủy đơn
- Khách tự hủy được khi đơn chưa thanh toán và cửa hàng chưa xác nhận đơn (trạng thái Chờ thanh toán hoặc Chờ xác nhận). Đơn đã được xác nhận thì liên hệ cửa hàng.
- Đơn đã chuyển khoản mà muốn hủy: liên hệ cửa hàng qua trang Góp ý để được hủy và hoàn tiền.
- Hoàn tiền thực hiện thủ công bởi cửa hàng sau khi xác nhận hủy.

## Mua lại
Trong "Đơn hàng của tôi" có nút mua lại để đưa các sản phẩm của đơn cũ vào giỏ hàng (chỉ thêm được sản phẩm còn hàng).
