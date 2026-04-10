/**
 * Messaging singleton — provides sendMsg and sendPortMessage to Lit components.
 *
 * app.ts initialises these via setSendMsg / setSendPortMessage after
 * establishing the chrome.runtime port.  Components import the proxy
 * functions which delegate to the real implementations.
 */

type SendMsgFn = <T = unknown>(msg: Record<string, unknown>) => Promise<T>;
type SendPortMsgFn = (msg: Record<string, unknown>) => void;

let _sendMsg: SendMsgFn | null = null;
let _sendPortMessage: SendPortMsgFn | null = null;

export function setSendMsg(fn: SendMsgFn): void {
  _sendMsg = fn;
}

export function setSendPortMessage(fn: SendPortMsgFn): void {
  _sendPortMessage = fn;
}

export function sendMsg<T = unknown>(msg: Record<string, unknown>): Promise<T> {
  if (!_sendMsg) throw new Error('sendMsg not initialized — call setSendMsg first');
  return _sendMsg(msg) as Promise<T>;
}

export function sendPortMessage(msg: Record<string, unknown>): void {
  if (!_sendPortMessage) throw new Error('sendPortMessage not initialized — call setSendPortMessage first');
  _sendPortMessage(msg);
}
