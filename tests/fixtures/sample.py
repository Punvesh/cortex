import os
from pathlib import Path

def greet(name: str) -> str:
    return f"Hello, {name}"

def _internal_helper():
    pass

class UserService:
    def get_user(self, user_id: str):
        greet(user_id)
        return Path(os.getcwd()) / user_id
