"""Validate {{ cookiecutter.app_name }} before generating anything."""
import re
import sys

APP_NAME = "{{ cookiecutter.app_name }}"

if not re.match(r"^[a-z][a-z0-9-]{0,63}$", APP_NAME):
    print(
        f"✗ invalid app name '{APP_NAME}'. "
        "Use lowercase letters/digits/hyphens, start with a letter.",
        file=sys.stderr,
    )
    sys.exit(1)
