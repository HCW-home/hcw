How to run tasks manually

```
# In a first console, run the scheduler (reddis is required)
celery -A core worker --loglevel=info

# In a second console
python3 manage.py shell
```

Create super user

```
python3 manage.py createsuperuser
```

Add Doctor group role

```
python3 manage.py loaddata initial/Groups.json
```



Dump Doctor group role

```
python3 manage.py dumpdata auth.group --natural-foreign --natural-primary --indent 2 > initial/Groups.json
```


Get language string to translate

```
./manage.py makemessages --locale=fr
./manage.py compilemessages
```
