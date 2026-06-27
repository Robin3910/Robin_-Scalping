// 事件总线 - 对应 Python 版本的 bus.py
// 轻量 pub-sub

type Subscriber = (env: any) => void;

export class EventBus {
  private subs: Map<string, Subscriber[]> = new Map();

  subscribe(topic: string, fn: Subscriber): void {
    if (!this.subs.has(topic)) {
      this.subs.set(topic, []);
    }
    this.subs.get(topic)!.push(fn);
  }

  unsubscribe(topic: string, fn: Subscriber): void {
    const list = this.subs.get(topic);
    if (list) {
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  publish(topic: string, payload: any): void {
    const env = { topic, ts: Date.now(), data: payload };
    const list = this.subs.get(topic);
    if (list) {
      for (const fn of [...list]) {
        try {
          fn(env);
        } catch (e) {
          console.error(`[bus] subscriber error on ${topic}:`, e);
        }
      }
    }
  }

  clear(): void {
    this.subs.clear();
  }
}
