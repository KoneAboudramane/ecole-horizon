.PHONY: install migrate seed run test schema
install:
	python -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
migrate:
	python manage.py migrate
seed:
	python manage.py seed_demo
run:
	python manage.py runserver
test:
	python -m pytest
schema:
	python manage.py spectacular --file openapi.yml
