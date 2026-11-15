import { api } from '../services/api-service.js';
import { escapeHtml } from '../utils/format.js';

// Chọn địa chỉ kiểu TikTok Shop: chọn Tỉnh/Thành phố trước, sau đó chọn Phường/Xã thuộc tỉnh đó.
// Dữ liệu hành chính từ 1/7/2025: 34 tỉnh/thành, dưới tỉnh là phường/xã/đặc khu, không còn quận/huyện.
// Mỗi ô là một dropdown có ô tìm: bấm vào là hiện đủ danh sách, gõ tới đâu lọc tới đó,
// chữ khớp được tô đậm, gõ không dấu cũng được. Chỉ nhận giá trị bấm chọn từ danh sách.
const MAX_SHOWN = 200;
let divisionsPromise = null;
const loadDivisions = () => (divisionsPromise ||= api.get('/divisions'));

// Bỏ dấu, chữ thường: "Bến Thành" -> "ben thanh". Mỗi ký tự giữ đúng 1 ký tự để tô đậm đúng chỗ.
const plain = (value) =>
    String(value || '')
        .normalize('NFC')
        .split('')
        .map((char) => char.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().charAt(0) || char)
        .join('');
const clean = (value) => plain(value).replace(/\s+/g, ' ').trim();
// Tên bỏ chữ "Phường", "Xã", "Tỉnh"... để ưu tiên kết quả bắt đầu đúng chữ khách gõ
const core = (key) => key.replace(/^(phuong|xa|dac khu|tinh|thanh pho)\s+/, '');
// Cách gọi tắt hay gặp
const ALIAS = { 'Thành phố Hồ Chí Minh': ' hcm tphcm sai gon', 'Thành phố Hà Nội': ' hn' };

// Tô đậm các đoạn của tên khớp với từ khóa (so sánh không dấu)
function highlight(label, words) {
    const text = String(label).normalize('NFC');
    const key = plain(text);
    const marks = new Array(text.length).fill(false);
    words.forEach((word) => {
        let at = key.indexOf(word);
        while (word && at !== -1) {
            for (let i = at; i < at + word.length; i += 1) marks[i] = true;
            at = key.indexOf(word, at + word.length);
        }
    });
    let html = '';
    let open = false;
    [...text].forEach((char, i) => {
        if (marks[i] !== open) {
            html += marks[i] ? '<mark>' : '</mark>';
            open = marks[i];
        }
        html += escapeHtml(char);
    });
    return open ? `${html}</mark>` : html;
}

// Lọc theo chữ gõ: bắt đầu đúng chữ gõ xếp trước, chứa chữ gõ xếp sau.
// Không khớp liền thì cho khớp từng từ (VD "thanh ben" vẫn ra "Bến Thành").
function search(items, query) {
    if (!query) return { rows: items, words: [] };
    const starts = items.filter((item) => core(item.key).startsWith(query));
    const rows = [...starts, ...items.filter((item) => !starts.includes(item) && item.key.includes(query))];
    if (rows.length) return { rows, words: [query] };
    const words = query.split(' ');
    return { rows: items.filter((item) => words.every((word) => item.key.includes(word))), words };
}

// Một ô gõ có danh sách gợi ý bên dưới.
// items(): danh sách chọn được, current(): tên đang chọn, onPick(item, moveOn): khi khách chọn
function combo(input, { items, current, onPick, hint, empty }) {
    const list = document.createElement('ul');
    list.className = 'combo-list hidden';
    list.setAttribute('role', 'listbox');
    input.after(list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('autocomplete', 'off');
    let shown = [];
    let active = -1;
    let typed = false; // khách đã gõ mà chưa chọn
    let held = ''; // placeholder gốc, trả lại khi rời ô

    function render() {
        const { rows, words } = search(items(), clean(input.value));
        shown = rows.slice(0, MAX_SHOWN);
        active = shown.length
            ? Math.max(
                  0,
                  shown.findIndex((item) => item.name === current())
              )
            : -1;
        list.innerHTML = shown.length
            ? shown
                  .map(
                      (item, i) =>
                          `<li role="option" data-i="${i}"><b>${highlight(item.name, words)}</b>${hint ? `<small>${hint(item)}</small>` : ''}</li>`
                  )
                  .join('') +
              (rows.length > MAX_SHOWN ? `<li class="combo-more">Còn ${rows.length - MAX_SHOWN} kết quả, gõ thêm để thu hẹp</li>` : '')
            : `<li class="combo-more">${empty()}</li>`;
        list.classList.remove('hidden');
        paint();
    }
    // Tô dòng đang chọn và cuộn danh sách (không cuộn cả trang) cho dòng đó hiện ra
    function paint() {
        list.querySelectorAll('[data-i]').forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === active));
        const li = list.querySelector('.active');
        if (!li) return;
        if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop;
        else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight)
            list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
    }
    const close = () => {
        list.classList.add('hidden');
        active = -1;
    };
    function pick(item, moveOn = true) {
        typed = false;
        input.value = item.name;
        input.classList.remove('invalid'); // đã chọn thì bỏ tô đỏ "còn thiếu"
        close();
        onPick(item, moveOn);
    }

    // Vào ô: để trống cho khách gõ, tên đang chọn hiện mờ ở placeholder, mở toàn bộ danh sách
    input.addEventListener('focus', () => {
        held = input.placeholder;
        if (current()) input.placeholder = current();
        input.value = '';
        typed = false;
        render();
    });
    // Bấm lại vào ô đang chọn thì đóng/mở danh sách như dropdown
    input.addEventListener('mousedown', () => {
        if (document.activeElement !== input) return;
        if (list.classList.contains('hidden')) render();
        else close();
    });
    input.addEventListener('input', () => {
        typed = true;
        render();
    });
    input.addEventListener('keydown', (event) => {
        if (list.classList.contains('hidden')) {
            if (event.key === 'ArrowDown') render();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            active = Math.max(0, Math.min(shown.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
            paint();
        } else if (event.key === 'Enter') {
            event.preventDefault(); // không gửi form khi đang chọn trong danh sách
            if (shown[active]) pick(shown[active]);
        } else if (event.key === 'Tab') {
            // Tab chọn luôn dòng đang tô rồi sang ô kế tiếp
            if (typed && shown[active]) pick(shown[active], false);
        } else if (event.key === 'Escape') close();
    });
    // mousedown thay vì click: chọn xong trước khi ô gõ mất focus
    list.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const li = event.target.closest('[data-i]');
        if (li) pick(shown[Number(li.dataset.i)]);
    });
    // Rời ô: gõ trọn đúng một tên (VD "tan dinh") thì chọn luôn, gõ dở thì giữ lựa chọn cũ
    input.addEventListener('blur', () => {
        input.placeholder = held;
        const query = clean(input.value);
        const exact = typed && shown.find((item) => [clean(item.name), core(clean(item.name))].includes(query));
        if (exact) pick(exact, false);
        input.value = current();
        close();
    });
}

export async function bindDivisions(provinceInput, wardInput) {
    let data;
    try {
        data = await loadDivisions();
    } catch (error) {
        // Không tải được danh sách (VD server chưa khởi động lại bản mới): bấm hay gõ vào ô tỉnh đều hiện lỗi trong dropdown
        divisionsPromise = null;
        console.error('[địa chỉ] Không tải được /api/divisions:', error.message);
        provinceInput.placeholder = 'Không tải được danh sách tỉnh/thành';
        provinceInput.classList.add('invalid');
        wardInput.disabled = true;
        const list = document.createElement('ul');
        list.className = 'combo-list hidden';
        list.innerHTML = `<li class="combo-more">Không tải được danh sách tỉnh/thành (${escapeHtml(error.message)}). Hãy khởi động lại server rồi tải lại trang.</li>`;
        provinceInput.after(list);
        const show = () => list.classList.remove('hidden');
        provinceInput.addEventListener('focus', show);
        provinceInput.addEventListener('input', show);
        provinceInput.addEventListener('blur', () => list.classList.add('hidden'));
        return null;
    }
    const byName = (a, b) => core(a.key).localeCompare(core(b.key), 'vi');
    const provinces = data.map(([name]) => ({ name, key: clean(name) + (ALIAS[name] || '') })).sort(byName);
    const wardsOf = new Map(data.map(([province, list]) => [province, list.map((name) => ({ name, key: clean(name) })).sort(byName)]));
    const chosen = { province: '', ward: '' };

    // Ô phường/xã chỉ mở khi đã chọn tỉnh
    function syncWard() {
        wardInput.disabled = !chosen.province;
        wardInput.placeholder = chosen.province ? 'Chọn hoặc gõ để tìm' : 'Chọn Tỉnh/Thành phố trước';
        wardInput.value = chosen.ward;
    }

    combo(provinceInput, {
        items: () => provinces,
        current: () => chosen.province,
        hint: (item) => `${wardsOf.get(item.name).length} phường/xã`,
        empty: () => 'Không tìm thấy tỉnh/thành. Thử gõ không dấu, VD: ho chi minh',
        onPick(item, moveOn) {
            // Đổi tỉnh thì phải chọn lại phường/xã
            if (item.name !== chosen.province) chosen.ward = '';
            chosen.province = item.name;
            syncWard();
            // Chọn tỉnh xong thì mở luôn danh sách phường/xã của tỉnh đó
            if (moveOn && !chosen.ward) wardInput.focus();
        }
    });
    combo(wardInput, {
        items: () => wardsOf.get(chosen.province) || [],
        current: () => chosen.ward,
        empty: () => `Không có phường/xã này ở ${escapeHtml(chosen.province)}. Thử gõ không dấu.`,
        onPick(item) {
            chosen.ward = item.name;
        }
    });
    syncWard();

    return {
        value: () => ({ ...chosen }),
        // Điền sẵn khi sửa địa chỉ đã lưu (địa chỉ cũ chưa có phường/tỉnh thì để trống cho khách chọn)
        set(place = {}) {
            chosen.province = wardsOf.has(place.province) ? place.province : '';
            chosen.ward = chosen.province && wardsOf.get(chosen.province).some((item) => item.name === place.ward) ? place.ward : '';
            provinceInput.value = chosen.province;
            syncWard();
        }
    };
}
