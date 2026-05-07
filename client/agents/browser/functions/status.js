import { request } from './request.js';

export default async function status() {
    return request('/state');
};
