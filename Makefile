subdirs = backend practitioner patient

.PHONY: $(subdirs) dev

install: $(subdirs)
clean: $(subdirs)
build: $(subdirs)

$(subdirs):
	make -C $@ $(MAKECMDGOALS)

dev: venv venv/bin/honcho patient/node_modules practitioner/node_modules
	venv/bin/honcho start

venv/bin/honcho:
	venv/bin/pip install -r backend/requirements.txt

venv:
	python3 -m venv venv

patient/node_modules:
	cd patient ; npx yarn install

practitioner/node_modules:
	cd practitioner ; npx yarn install
