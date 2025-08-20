How to run tasks manually

```
# In a first console, run the scheduler (reddis is required)
celery -A core worker --loglevel=info

# In a second console
python3 manage.py shell
from market import tasks
tasks.run_all.delay()
```

Create super user

```
python3 manage.py createsuperuser
```

Get all history

```
python3 manage.py market get_history
```
