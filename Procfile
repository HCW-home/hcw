backend: sh -c 'venv/bin/python backend/manage.py migrate && venv/bin/python backend/manage.py runserver'
celery: venv/bin/watchfiles --filter python "venv/bin/celery -A core --workdir=backend worker --loglevel=info" backend
patient: npm --prefix patient run start
practitioner: npm --prefix practitioner run start
