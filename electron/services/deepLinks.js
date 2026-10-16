import { APP_PROTOCOL } from './identityConfig.js';

export function parseDeepLink(input) {
    if (typeof input !== 'string') return null;
    let url;
    try {
        url = new URL(input);
    } catch {
        return null;
    }
    if (url.protocol !== `${APP_PROTOCOL}:`) return null;
    const route = `${url.hostname}${url.pathname}`;
    if (route === 'open') return { hash: '', listid: '', teamcode: '', urlPath: 'open' };
    if (route === 'share') {
        const hash = url.searchParams.get('hash') || '';
        const listid = url.searchParams.get('listid') || '';
        if (!hash && !listid) return null;
        return { hash, listid, teamcode: '', urlPath: 'share' };
    }
    if (route === 'team/join') {
        const teamcode = url.searchParams.get('code') || '';
        if (!teamcode) return null;
        return { hash: '', listid: '', teamcode, urlPath: 'join' };
    }
    return null;
}

// 冷启动时先排队，等 Vue 已安装 URL 监听器后才投递；每条链接只发送一次。
export function createDeepLinkQueue(deliver) {
    let ready = false;
    const pending = [];
    return {
        receive(input) {
            const params = parseDeepLink(input);
            if (!params) return false;
            if (params.urlPath === 'open') return true;
            if (ready) deliver(params);
            else pending.push(params);
            return true;
        },
        setReady(value) {
            ready = value;
            if (ready) {
                while (pending.length) deliver(pending.shift());
            }
        }
    };
}
