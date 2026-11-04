import { Router } from 'express';
import { byId, newId, save } from '../core/store.js';
import { fail, handle, requireRole } from '../core/http.js';
import { MAX_ADDRESSES, parseAddress } from '../core/rules.js';

const router = Router();
router.use(requireRole('user'));

const book = (req) => (byId('user', req.user.id).addresses ||= []);
const find = (req) => book(req).find((item) => item.id === req.params.id) || fail(404, 'Không tìm thấy địa chỉ.');

router.get('/', handle((req, res) => res.json(book(req))));

router.post('/', handle((req, res) => {
    const addresses = book(req);
    if (addresses.length >= MAX_ADDRESSES) fail(409, `Mỗi tài khoản chỉ lưu tối đa ${MAX_ADDRESSES} địa chỉ.`);
    const entry = { id: newId(), ...parseAddress(req.body), isDefault: addresses.length === 0 || req.body?.isDefault === true };
    if (entry.isDefault) addresses.forEach((item) => { item.isDefault = false; });
    addresses.push(entry);
    save();
    res.status(201).json(addresses);
}));

router.put('/:id', handle((req, res) => {
    const entry = find(req);
    Object.assign(entry, parseAddress(req.body));
    if (req.body?.isDefault === true) book(req).forEach((item) => { item.isDefault = item === entry; });
    save();
    res.json(book(req));
}));

router.delete('/:id', handle((req, res) => {
    const addresses = book(req);
    const entry = find(req);
    addresses.splice(addresses.indexOf(entry), 1);
    if (entry.isDefault && addresses.length) addresses[0].isDefault = true;
    save();
    res.json(addresses);
}));

export default router;
