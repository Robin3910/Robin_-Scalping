"""
带 deque 的环形日志，供前端实时显示。
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass
import time
import threading
from typing import Deque, List, Optional


@dataclass
class LogEntry:
    ts: float
    level: str      # INFO / WARN / ERROR / TRADE
    msg: str

    def to_dict(self) -> dict:
        return {"ts": self.ts, "level": self.level, "msg": self.msg,
                "tstr": time.strftime("%H:%M:%S", time.localtime(self.ts))}


class LogBuffer:
    def __init__(self, size: int = 500) -> None:
        self._buf: Deque[LogEntry] = deque(maxlen=size)
        self._lock = threading.Lock()

    def push(self, level: str, msg: str) -> None:
        with self._lock:
            self._buf.append(LogEntry(ts=time.time(), level=level, msg=msg))

    def info(self, msg: str) -> None: self.push("INFO", msg)
    def warn(self, msg: str) -> None: self.push("WARN", msg)
    def error(self, msg: str) -> None: self.push("ERROR", msg)
    def trade(self, msg: str) -> None: self.push("TRADE", msg)

    def tail(self, n: int = 100) -> List[dict]:
        with self._lock:
            return [e.to_dict() for e in list(self._buf)[-n:]]
