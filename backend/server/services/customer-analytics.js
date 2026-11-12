import { db } from '../core/store.js';
import { events } from './analytics.js';

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const dayKey = (time) => new Date(time + VN_OFFSET_MS).toISOString().slice(0, 10);

export function buildCustomerAnalytics(days = 30, now = Date.now()) {
    const from = now - days * 86400000;
    const previousFrom = from - days * 86400000;
    const customers = db.user.filter((user) => user.role === 'user' && user.verified !== false);
    const ordersByUser = new Map();
    db.orders.forEach((order) => {
        const rows = ordersByUser.get(String(order.userId)) || [];
        rows.push(order);
        ordersByUser.set(String(order.userId), rows);
    });
    const firstPaidOrder = new Map();
    ordersByUser.forEach((orders, userId) => {
        const first = orders
            .filter((order) => order.status !== 'cancelled')
            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
        if (first) firstPaidOrder.set(userId, Date.parse(first.createdAt));
    });

    const inWindow = (time, start) => time >= start && time < now;
    const visitorsInWindow = (start) => new Set(events.filter((event) => event.t >= start && event.t < now).map((event) => event.v));
    const buyersInWindow = (start) =>
        new Set(
            db.orders
                .filter((order) => order.status !== 'cancelled' && inWindow(Date.parse(order.createdAt), start))
                .map((order) => String(order.userId))
        );
    const currentVisitors = visitorsInWindow(from);
    const previousVisitors = visitorsInWindow(previousFrom);
    const currentBuyers = buyersInWindow(from);
    const previousBuyers = buyersInWindow(previousFrom);
    const firstTimeBuyers = [...currentBuyers].filter((id) => inWindow(firstPaidOrder.get(id) ?? Infinity, from));
    const repeatBuyers = [...currentBuyers].filter((id) => (firstPaidOrder.get(id) ?? Infinity) < from);
    const neverOrdered = customers.filter((user) => !(ordersByUser.get(String(user.id)) || []).length);
    const newRegistrations = customers.filter((user) => inWindow(Date.parse(user.createdAt), from));

    const daily = new Map();
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const date = dayKey(now - offset * 86400000);
        daily.set(date, {
            date,
            visitors: new Set(),
            pageViews: 0,
            registrations: 0,
            neverOrderedRegistrations: 0,
            buyers: new Set(),
            firstTimeBuyers: new Set(),
            repeatBuyers: new Set(),
            orders: 0
        });
    }
    events
        .filter((event) => event.t >= from && event.t < now)
        .forEach((event) => {
            const row = daily.get(dayKey(event.t));
            if (!row) return;
            row.visitors.add(event.v);
            if (event.type === 'pv') row.pageViews += 1;
        });
    newRegistrations.forEach((user) => {
        const row = daily.get(dayKey(Date.parse(user.createdAt)));
        if (!row) return;
        row.registrations += 1;
        if (!(ordersByUser.get(String(user.id)) || []).length) row.neverOrderedRegistrations += 1;
    });
    db.orders
        .filter((order) => order.status !== 'cancelled' && inWindow(Date.parse(order.createdAt), from))
        .forEach((order) => {
            const row = daily.get(dayKey(Date.parse(order.createdAt)));
            if (!row) return;
            const userId = String(order.userId);
            row.orders += 1;
            row.buyers.add(userId);
            if (inWindow(firstPaidOrder.get(userId) ?? Infinity, from)) row.firstTimeBuyers.add(userId);
            else row.repeatBuyers.add(userId);
        });

    return {
        days,
        generatedAt: new Date(now).toISOString(),
        definitions: {
            visitor: 'Mã truy cập ẩn danh; không ghép danh tính với tài khoản khách hàng.',
            neverOrdered: 'Tài khoản khách hàng chưa có bất kỳ đơn nào, kể cả đơn đã hủy.',
            firstTimeBuyer: 'Khách có đơn không bị hủy đầu tiên trong toàn bộ lịch sử rơi vào kỳ xem.',
            repeatBuyer: 'Khách có đơn không bị hủy trong kỳ và đã có đơn không bị hủy trước kỳ.'
        },
        summary: {
            registeredCustomers: customers.length,
            newRegistrations: newRegistrations.length,
            neverOrderedCustomers: neverOrdered.length,
            neverOrderedRegistrations: newRegistrations.filter((user) => !(ordersByUser.get(String(user.id)) || []).length).length,
            buyers: currentBuyers.size,
            firstTimeBuyers: firstTimeBuyers.length,
            repeatBuyers: repeatBuyers.length,
            orders: db.orders.filter((order) => order.status !== 'cancelled' && inWindow(Date.parse(order.createdAt), from)).length,
            visitors: currentVisitors.size,
            previousVisitors: previousVisitors.size,
            previousBuyers: previousBuyers.size
        },
        daily: [...daily.values()].map((row) => ({
            date: row.date,
            visitors: row.visitors.size,
            pageViews: row.pageViews,
            registrations: row.registrations,
            neverOrderedRegistrations: row.neverOrderedRegistrations,
            buyers: row.buyers.size,
            firstTimeBuyers: row.firstTimeBuyers.size,
            repeatBuyers: row.repeatBuyers.size,
            orders: row.orders
        }))
    };
}
