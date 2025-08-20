STATIC=/usr/share
VAR=/var
PROJECT=hcw
VERSION := $(shell head -n 1 debian/changelog | cut -d\( -f2 | cut -d\) -f1 | cut -d\~ -f1)

all:
	echo "Nothing to prepare"

${STATIC}/${PROJECT}/venv:
	mkdir -p ${STATIC}/${PROJECT}/venv
	python3 -m venv ${STATIC}/${PROJECT}/venv
	. ${STATIC}/${PROJECT}/venv/bin/activate ; pip3 install -r requirements.txt
	# TODO : test the following line
	# ${STATIC}/${PROJECT}/venv/bin/python3 manage.py collectstatic
	mkdir -p $(DESTDIR)/${STATIC}/${PROJECT}
	mv ${STATIC}/${PROJECT}/venv $(DESTDIR)/${STATIC}/${PROJECT}

install: ${STATIC}/${PROJECT}/venv
	mkdir -p $(DESTDIR)/${STATIC}/${PROJECT}
	cp -a statics ads alerts api core lptracker market news users manage.py discord_bot sponsors $(DESTDIR)/${STATIC}/${PROJECT}
	mkdir -p $(DESTDIR)/etc/${PROJECT}
	cp .env-dist $(DESTDIR)/etc/${PROJECT}/${PROJECT}.conf
	mkdir -p $(DESTDIR)/${VAR}/${PROJECT}