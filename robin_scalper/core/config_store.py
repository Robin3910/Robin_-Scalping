"""
配置加载：JSON 持久化 + 热重载（监听 mtime）。
"""
from __future__ import annotations
import json
import os
import time
from typing import Optional
from .config import Config, default_config


DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "config", "config.json",
)


def load_config(path: str = DEFAULT_PATH) -> Config:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                d = json.load(f)
            return Config.from_dict(d)
        except Exception as e:
            print(f"[config] 加载 {path} 失败: {e}，使用默认值")
    return default_config()


def save_config(cfg: Config, path: str = DEFAULT_PATH) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cfg.last_modified = time.time()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg.to_dict(), f, indent=2, ensure_ascii=False)


class ConfigWatcher:
    """文件 mtime 检测，最小实现"""
    def __init__(self, path: str = DEFAULT_PATH):
        self.path = path
        self._mtime = 0.0

    def is_modified(self) -> bool:
        if not os.path.exists(self.path):
            return False
        mt = os.path.getmtime(self.path)
        if mt != self._mtime:
            self._mtime = mt
            return True
        return False
