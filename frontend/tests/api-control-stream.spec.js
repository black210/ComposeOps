import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamComposeControl } from '../src/api/client.js';
afterEach(() => vi.unstubAllGlobals());
const response = text => new Response(text, { headers: { 'content-type': 'text/event-stream' } });
describe('启停执行流', () => {
  it('发送精确容器范围，等待退出帧再完成', async () => {
    const fetch = vi.fn().mockResolvedValue(response('data: {"type":"stdout","data":"ok"}\n\ndata: {"type":"exit","data":{"code":0}}'));
    vi.stubGlobal('fetch', fetch);
    const frames = [];
    await streamComposeControl('p', 'up', frame => frames.push(frame), null, { action: 'up', containerId: 'target' });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'up', containerId: 'target' });
    expect(frames.at(-1)).toEqual({ type: 'exit', data: { code: 0 } });
  });
  it('没有退出帧的断流明确报错，不能默认为执行成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('data: {"type":"stdout","data":"working"}\n\n')));
    await expect(streamComposeControl('p', 'up', () => {})).rejects.toThrow('未收到执行结果');
  });
});
