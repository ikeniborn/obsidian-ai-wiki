SHELL := /bin/bash
ENV_FILE := .env

define load_env
$(if $(wildcard $(ENV_FILE)),set -a && source <(sed 's/[[:space:]]*#.*//' $(ENV_FILE) | grep -v '^[[:space:]]*$$') && set +a &&)
endef

.PHONY: sync run test

sync:
	$(load_env) uv sync

run:
	$(load_env) uv run python optimize.py

test:
	$(load_env) uv run pytest
