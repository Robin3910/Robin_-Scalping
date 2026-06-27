"""
带 deque 的环形日志，供前端实时显示，并同时写入文件。
"""
from __future__ import annotations
from collections import deque
from dataclasses import dataclass
import time
import threading
import os
from typing import Deque, List, Optional


@dataclass
class LogEntry:
    ts: float
    level: str      # INFO / WARN / ERROR / TRADE
    msg: str

    def to_dict(self) -> dict:
        return {"ts": self.ts, "level": self.level, "msg": self.msg,
                "tstr": time.strftime("%H:%M:%S", time.localtime(self.ts))}

    def to_file_line(self) -> str:
        return f"[{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(self.ts))}] [{self.level:5}] {self.msg}"


class LogBuffer:
    def __init__(self, size: int = 500, log_dir: str = "logs", log_file: str = "trades.log") -> None:
        self._buf: Deque[LogEntry] = deque(maxlen=size)
        self._lock = threading.Lock()
        self._file_lock = threading.Lock()
        self._log_dir = log_dir
        self._log_file = log_file
        self._file_handle: Optional[object] = None
        self._init_file()

    def _init_file(self) -> None:
        if not os.path.exists(self._log_dir):
            os.makedirs(self._log_dir, exist_ok=True)
        log_path = os.path.join(self._log_dir, self._log_file)
        self._file_handle = open(log_path, "a", encoding="utf-8")

    def push(self, level: str, msg: str) -> None:
        entry = LogEntry(ts=time.time(), level=level, msg=msg)
        with self._lock:
            self._buf.append(entry)
        with self._file_lock:
            if self._file_handle:
                try:
                    self._file_handle.write(entry.to_file_line() + "\n")
                    self._file_handle.flush()
                except Exception:
                    pass

    def info(self, msg: str) -> None: self.push("INFO", msg)
    def warn(self, msg: str) -> None: self.push("WARN", msg)
    def error(self, msg: str) -> None: self.push("ERROR", msg)
    def trade(self, msg: str) -> None: self.push("TRADE", msg)

    def tail(self, n: int = 100) -> List[dict]:
        with self._lock:
            return [e.to_dict() for e in list(self._buf)[-n:]]

    def close(self) -> None:
        with self._file_lock:
            if self._file_handle:
                self._file_handle.close()
                self._file_handle = None
