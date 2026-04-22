subdirs = backend practitioner patient

.PHONY: $(subdirs) dev

install: $(subdirs)
clean: $(subdirs)
build: $(subdirs)

$(subdirs):
	make -C $@ $(MAKECMDGOALS)

dev: venv
	venv/bin/honcho start

venv:
	python3 -m venv venv
	venv/bin/pip install -r backend/requirements.txt
