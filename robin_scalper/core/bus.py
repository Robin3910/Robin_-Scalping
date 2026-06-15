"""
事件总线：轻量 pub-sub。WebSocket 推送、策略触发、前端订阅都通过它。
"""
from __future__ import annotations
import asyncio
import time
from collections import defaultdict
from typing import Any, Callable, Dict, List, Awaitable


class EventBus:
    def __init__(self, loop_factory: Callable[[], asyncio.AbstractEventLoop] | None = None) -> None:
        self._subs: Dict[str, List[Callable[[dict], Awaitable[None] | None]]] = defaultdict(list)
        self._loop_factory = loop_factory
        self._loop: asyncio.AbstractEventLoop | None = None

    def attach_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """由主线程在事件循环起来后注入"""
        self._loop = loop

    def subscribe(self, topic: str, fn: Callable[[dict], Any]) -> None:
        self._subs[topic].append(fn)

    def unsubscribe(self, topic: str, fn: Callable[[dict], Any]) -> None:
        if fn in self._subs.get(topic, []):
            self._subs[topic].remove(fn)

    async def publish(self, topic: str, payload: dict) -> None:
        for fn in list(self._subs.get(topic, [])):
            try:
                r = fn(self._envelope(topic, payload))
                if asyncio.iscoroutine(r):
                    await r
            except Exception as e:  # 不要因为单个订阅者拖垮总线
                print(f"[bus] subscriber error on {topic}: {e}")

    def publish_sync(self, topic: str, payload: dict) -> None:
        """
        给非 asyncio 线程（websocket-client fallback 路径）使用的同步发布。
        如果有 loop 且在运行，则丢到 loop 里跑；否则直接同步调用订阅者。
        """
        env = self._envelope(topic, payload)
        loop = self._loop
        if loop is not None and loop.is_running():
            try:
                asyncio.run_coroutine_threadsafe(self._dispatch(env), loop)
            except Exception as e:
                print(f"[bus] publish_sync schedule error on {topic}: {e}")
        else:
            # 没在主循环：直接同步调用所有订阅者
            self._dispatch_sync(env)

    def _dispatch_sync(self, env: dict) -> None:
        topic = env["topic"]
        for fn in list(self._subs.get(topic, [])):
            try:
                r = fn(env)
                if asyncio.iscoroutine(r):
                    # 同步模式下丢弃异步订阅
                    continue
            except Exception as e:
                print(f"[bus] subscriber error on {topic}: {e}")

    async def _dispatch(self, env: dict) -> None:
        topic = env["topic"]
        for fn in list(self._subs.get(topic, [])):
            try:
                r = fn(env)
                if asyncio.iscoroutine(r):
                    await r
            except Exception as e:
                print(f"[bus] subscriber error on {topic}: {e}")

    @staticmethod
    def _envelope(topic: str, payload: dict) -> dict:
        return {"topic": topic, "ts": time.time(), "data": payload}
