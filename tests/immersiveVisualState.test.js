import test from 'node:test';
import assert from 'node:assert/strict';
import { readImmersiveVisualState } from '../src/components/immersive/visualState.js';

const root = values => ({ getAttribute: name => values[name] ?? null });
test('插件没有启用标记时保留原全屏界面', () => {
    assert.deepEqual(readImmersiveVisualState(root({})), { enabled: false, reduceMotion: false, lowBlur: false, windowVisible: true });
    assert.equal(readImmersiveVisualState(root({ 'data-mico-liquid-glass': 'off' })).enabled, false);
});
test('只读取精确插件标记和降级设置，不推测相近状态', () => {
    assert.deepEqual(readImmersiveVisualState(root({
        'data-mico-liquid-glass': 'on', 'data-mico-liquid-glass-motion': 'reduced', 'data-mico-liquid-glass-blur': 'low'
    })), { enabled: true, reduceMotion: true, lowBlur: true, windowVisible: true });
    assert.equal(readImmersiveVisualState(root({ 'data-mico-liquid-glass': 'ON' })).enabled, false);
    assert.equal(readImmersiveVisualState(null).enabled, false);
});
test('原生隐藏标记停止视觉，即使插件仍开启也不推测网页 visibilityState', () => {
    const state = readImmersiveVisualState(root({ 'data-mico-liquid-glass': 'on', 'data-mico-window-visible': 'false' }));
    assert.equal(state.enabled, true);
    assert.equal(state.windowVisible, false);
    assert.equal(readImmersiveVisualState(root({ 'data-mico-window-visible': 'true' })).windowVisible, true);
});
