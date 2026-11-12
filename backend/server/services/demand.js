import { events } from './analytics.js';
import { db } from '../core/store.js';
import { LOW_STOCK_AT } from '../core/rules.js';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MIN_DWELL_MS = 2000; // xem dưới 2 giây coi như bấm nhầm, không tính thời gian xem
const BOUNCE_MAX_MS = 10000; // thoát nhanh: 1 trang và ở lại dưới 10 giây
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
const median = (list) => {
    if (!list.length) return 0;
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Tổng hợp nhu cầu khách hàng từ nhật ký hành vi (events) và đơn hàng thật (db.orders).
 * Mọi con số đều tính lại từ dữ liệu gốc mỗi lần gọi, không có số liệu sinh sẵn.
 */
export function buildDemand(days) {
    const since = Date.now() - days * 86400000;
    const list = events.filter((event) => event.t >= since);

    // ---- Phiên truy cập
    const sessions = new Map();
    list.forEach((event) => {
        const session = sessions.get(event.s) || {
            id: event.s,
            v: event.v,
            first: event.t,
            last: event.t,
            pages: 0,
            active: 0,
            interacted: false,
            dev: null
        };
        session.first = Math.min(session.first, event.t);
        session.last = Math.max(session.last, event.t);
        if (event.type === 'pv') session.pages += 1;
        if (event.type === 'leave') session.active += event.dur || 0;
        if (['add_cart', 'search', 'filter', 'checkout', 'order'].includes(event.type)) session.interacted = true;
        if (event.dev) session.dev = event.dev;
        sessions.set(event.s, session);
    });
    const sessionList = [...sessions.values()];
    const visitors = new Set(list.map((event) => event.v));
    const sessionsPerVisitor = new Map();
    sessionList.forEach((session) => sessionsPerVisitor.set(session.v, (sessionsPerVisitor.get(session.v) || 0) + 1));

    const timed = sessionList.filter((session) => session.active > 0);
    const bounced = sessionList.filter((session) => session.pages <= 1 && !session.interacted && session.active < BOUNCE_MAX_MS);

    // ---- Phễu chuyển đổi (theo khách truy cập)
    const stage = (predicate) => new Set(list.filter(predicate).map((event) => event.v)).size;
    const funnel = [
        ['Truy cập website', visitors.size],
        ['Xem trang sản phẩm', stage((event) => event.type === 'pv' && event.pid)],
        ['Thêm vào giỏ hàng', stage((event) => event.type === 'add_cart')],
        ['Bắt đầu thanh toán', stage((event) => event.type === 'checkout')],
        ['Đặt hàng thành công', stage((event) => event.type === 'order')]
    ].map(([label, count], index, all) => ({
        label,
        count,
        ofTotal: pct(count, all[0][1]),
        ofPrevious: index === 0 ? 100 : pct(count, all[index - 1][1])
    }));

    // ---- Sản phẩm: quan tâm (xem, thời gian xem, thêm giỏ) đối chiếu với bán thật
    const orderedUnits = new Map();
    db.orders
        .filter((order) => Date.parse(order.createdAt) >= since && order.status !== 'cancelled')
        .forEach((order) => {
            order.items.forEach((item) => orderedUnits.set(String(item.id), (orderedUnits.get(String(item.id)) || 0) + item.qty));
        });
    const categoryName = (id) => db.categories.find((category) => Number(category.id) === Number(id))?.name || 'Khác';

    const rows = db.products.map((product) => {
        const id = String(product.id);
        const views = list.filter((event) => event.type === 'pv' && event.pid === id);
        const dwell = list.filter((event) => event.type === 'leave' && event.pid === id).map((event) => event.dur || 0);
        const dwellTotal = dwell.reduce((a, b) => a + b, 0);
        const carts = list.filter((event) => event.type === 'add_cart' && event.pid === id);
        const viewers = new Set(views.map((event) => event.v)).size;
        const cartAdds = carts.reduce((sum, event) => sum + (event.qty || 1), 0);
        return {
            id,
            name: product.name,
            image: product.image,
            category: categoryName(product.categoryId),
            categoryId: product.categoryId,
            price: product.price,
            stock: product.stock,
            views: views.length,
            viewers,
            avgDwellSec: views.length ? Math.round(dwellTotal / views.length / 1000) : 0,
            totalDwellMin: Math.round((dwellTotal / 60000) * 10) / 10,
            cartEvents: carts.length,
            cartAdds,
            cartRate: pct(carts.length, views.length),
            ordered: orderedUnits.get(id) || 0
        };
    });

    // Điểm quan tâm = số người xem + 2 điểm mỗi phút xem + 4 điểm mỗi lượt thêm giỏ; quy về thang 0-100.
    rows.forEach((row) => {
        row.score = row.viewers + row.totalDwellMin * 2 + row.cartEvents * 4;
    });
    const maxScore = Math.max(...rows.map((row) => row.score), 0);
    rows.forEach((row) => {
        const scaled = maxScore ? Math.round((row.score / maxScore) * 100) : 0;
        row.score = scaled;
        row.level = !row.views ? 'none' : scaled >= 60 ? 'high' : scaled >= 25 ? 'medium' : 'low';
    });
    rows.sort((a, b) => b.score - a.score || b.views - a.views);

    // ---- Danh mục
    const byCategory = new Map();
    rows.forEach((row) => {
        const entry = byCategory.get(row.category) || { name: row.category, views: 0, carts: 0, ordered: 0 };
        entry.views += row.views;
        entry.carts += row.cartEvents;
        entry.ordered += row.ordered;
        byCategory.set(row.category, entry);
    });
    const categories = [...byCategory.values()].sort((a, b) => b.views - a.views);

    // ---- Từ khóa tìm kiếm (từ khóa không có kết quả = nhu cầu cửa hàng chưa đáp ứng)
    const searches = new Map();
    list.filter((event) => event.type === 'search').forEach((event) => {
        const entry = searches.get(event.q) || { q: event.q, count: 0, visitors: new Set(), results: [] };
        entry.count += 1;
        entry.visitors.add(event.v);
        entry.results.push(event.n);
        searches.set(event.q, entry);
    });
    const keywords = [...searches.values()]
        .map((entry) => ({
            q: entry.q,
            count: entry.count,
            visitors: entry.visitors.size,
            results: Math.round(avg(entry.results)),
            noResult: entry.results.every((n) => n === 0)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);

    // ---- Khung giờ (giờ Việt Nam) và thiết bị
    const hours = Array.from({ length: 24 }, () => 0);
    const weekdays = Array.from({ length: 7 }, () => 0);
    list.filter((event) => event.type === 'pv').forEach((event) => {
        const at = new Date(event.t + VN_OFFSET_MS);
        hours[at.getUTCHours()] += 1;
        weekdays[at.getUTCDay()] += 1;
    });
    const devices = {
        mobile: sessionList.filter((session) => session.dev === 'm').length,
        desktop: sessionList.filter((session) => session.dev === 'd').length
    };

    // ---- Trang được xem nhiều
    const pages = new Map();
    list.forEach((event) => {
        if (!event.page) return;
        const entry = pages.get(event.page) || { page: event.page, views: 0, dwell: [] };
        if (event.type === 'pv') entry.views += 1;
        if (event.type === 'leave' && event.dur >= MIN_DWELL_MS) entry.dwell.push(event.dur);
        pages.set(event.page, entry);
    });
    const topPages = [...pages.values()]
        .filter((entry) => entry.views)
        .map((entry) => ({ page: entry.page, views: entry.views, avgDwellSec: Math.round(avg(entry.dwell) / 1000) }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 8);

    const summary = {
        visitors: visitors.size,
        returning: [...sessionsPerVisitor.values()].filter((count) => count > 1).length,
        sessions: sessionList.length,
        pageViews: list.filter((event) => event.type === 'pv').length,
        avgSessionSec: Math.round(avg(timed.map((session) => session.active)) / 1000),
        pagesPerSession: sessionList.length
            ? Math.round((list.filter((event) => event.type === 'pv').length / sessionList.length) * 10) / 10
            : 0,
        bounceRate: pct(bounced.length, sessionList.length),
        conversion: pct(funnel[4].count, visitors.size),
        cartAbandon: funnel[2].count ? pct(funnel[2].count - funnel[4].count, funnel[2].count) : 0
    };

    return {
        days,
        hasData: list.length > 0,
        since: new Date(since).toISOString(),
        summary,
        funnel,
        products: rows,
        categories,
        keywords,
        hours,
        weekdays,
        devices,
        topPages,
        insights: buildInsights({ summary, funnel, rows, keywords, hours })
    };
}

// Nhận định bằng lời cho admin, sinh từ các quy tắc rõ ràng trên số liệu ở trên.
function buildInsights({ summary, funnel, rows, keywords, hours }) {
    const out = [];
    const add = (level, title, detail) => out.push({ level, title, detail });
    const seen = rows.filter((row) => row.views > 0);
    if (!summary.sessions)
        return [
            {
                level: 'info',
                title: 'Chưa có dữ liệu hành vi',
                detail: 'Hệ thống bắt đầu ghi nhận từ khi khách truy cập website. Hãy quay lại sau khi có lượt xem.'
            }
        ];

    // Hết/sắp hết hàng mà khách vẫn quan tâm = cơ hội mất doanh thu
    rows.filter((row) => row.stock <= 0 && row.views > 0).forEach((row) =>
        add(
            'danger',
            `“${row.name}” hết hàng nhưng vẫn có ${row.viewers} người xem`,
            'Khách đang tìm sản phẩm này mà không mua được. Nên nhập thêm hoặc gợi ý sản phẩm thay thế.'
        )
    );
    rows.filter((row) => row.stock > 0 && row.stock <= LOW_STOCK_AT && row.level === 'high').forEach((row) =>
        add(
            'warning',
            `“${row.name}” nhu cầu cao nhưng chỉ còn ${row.stock}`,
            'Sản phẩm đang được quan tâm nhiều và sắp hết, nên nhập thêm sớm.'
        )
    );

    // Xem nhiều nhưng ít thêm giỏ
    const medianViews = median(seen.map((row) => row.views));
    seen.filter((row) => row.views >= Math.max(5, medianViews) && row.cartRate < 5 && row.stock > 0)
        .slice(0, 3)
        .forEach((row) =>
            add(
                'warning',
                `“${row.name}”: nhiều lượt xem nhưng ít thêm giỏ (${row.cartRate}%)`,
                'Khách quan tâm nhưng chưa quyết định mua. Cân nhắc xem lại giá, ảnh, mô tả hoặc khuyến mãi.'
            )
        );

    // Xem rất kỹ nhưng ít người biết tới
    const avgDwell = avg(seen.filter((row) => row.avgDwellSec > 0).map((row) => row.avgDwellSec));
    seen.filter((row) => row.avgDwellSec > avgDwell * 1.5 && row.views <= medianViews && row.views >= 2)
        .slice(0, 2)
        .forEach((row) =>
            add(
                'info',
                `“${row.name}”: ít người xem nhưng xem rất kỹ (${row.avgDwellSec} giây)`,
                'Người đã vào thì quan tâm sâu. Nên đưa sản phẩm lên nổi bật hoặc quảng bá thêm.'
            )
        );

    // Thêm giỏ nhiều nhưng bán ít
    seen.filter((row) => row.cartEvents >= 3 && row.ordered < row.cartEvents / 3)
        .slice(0, 2)
        .forEach((row) =>
            add(
                'warning',
                `“${row.name}”: ${row.cartEvents} lượt thêm giỏ nhưng chỉ ${row.ordered} sản phẩm được đặt`,
                'Khách bỏ giữa chừng. Kiểm tra phí vận chuyển, tồn kho và các bước thanh toán.'
            )
        );

    // Từ khóa không có kết quả
    keywords
        .filter((keyword) => keyword.noResult)
        .slice(0, 3)
        .forEach((keyword) =>
            add(
                'danger',
                `Khách tìm “${keyword.q}” (${keyword.count} lần) nhưng cửa hàng chưa có`,
                'Đây là nhu cầu chưa được đáp ứng. Cân nhắc bổ sung sản phẩm hoặc từ khóa gần nghĩa.'
            )
        );

    // Tỉ lệ bỏ giỏ / thoát
    if (funnel[2].count >= 3 && summary.cartAbandon >= 60) {
        add(
            'warning',
            `${summary.cartAbandon}% khách thêm giỏ nhưng không đặt hàng`,
            `${funnel[2].count} khách thêm giỏ, ${funnel[4].count} khách đặt hàng. Có thể do phí ship, bước xác nhận email hoặc thanh toán.`
        );
    }
    if (funnel[3].count >= 3 && funnel[4].count / funnel[3].count < 0.5) {
        add(
            'warning',
            `Chỉ ${pct(funnel[4].count, funnel[3].count)}% khách vào thanh toán đặt hàng xong`,
            'Khách bỏ ngang ở bước thanh toán. Xem lại quy trình xác nhận mã email và thanh toán SePay.'
        );
    }
    if (summary.sessions >= 5 && summary.bounceRate >= 60) {
        add(
            'warning',
            `Tỉ lệ thoát cao (${summary.bounceRate}%)`,
            'Nhiều khách rời đi sau một trang. Cải thiện trang đầu, ảnh và sản phẩm nổi bật.'
        );
    }

    // Giờ cao điểm
    const total = hours.reduce((a, b) => a + b, 0);
    if (total >= 10) {
        let bestStart = 0;
        let bestSum = -1;
        for (let hour = 0; hour < 24; hour += 1) {
            const sum = hours[hour] + hours[(hour + 1) % 24] + hours[(hour + 2) % 24];
            if (sum > bestSum) {
                bestSum = sum;
                bestStart = hour;
            }
        }
        add(
            'info',
            `Khách truy cập nhiều nhất từ ${bestStart}h đến ${(bestStart + 3) % 24}h`,
            `Chiếm ${pct(bestSum, total)}% lượt xem. Nên đăng khuyến mãi và có người trực hỗ trợ vào khung giờ này.`
        );
    }

    // Sản phẩm nhu cầu cao đang bán tốt
    const top = seen.filter((row) => row.level === 'high').slice(0, 3);
    if (top.length)
        add(
            'good',
            `Nhu cầu cao nhất: ${top.map((row) => row.name).join(', ')}`,
            'Các sản phẩm này được xem lâu và thêm giỏ nhiều nhất. Ưu tiên tồn kho, ảnh đẹp và đặt ở vị trí nổi bật.'
        );

    if (!out.length)
        add(
            'good',
            'Chưa phát hiện vấn đề rõ rệt',
            'Hành vi khách đang ổn trong khoảng thời gian này. Tiếp tục theo dõi khi có thêm dữ liệu.'
        );
    const order = { danger: 0, warning: 1, info: 2, good: 3 };
    return out.sort((a, b) => order[a.level] - order[b.level]);
}
