DOCKER_USERNAME ?= rg.nl-ams.scw.cloud/reactis
APPLICATION_NAME ?= agapprove-api

all: build push

build:
	docker build -f apps/api/Dockerfile -t ${DOCKER_USERNAME}/${APPLICATION_NAME}:${v} .

push:
	docker push ${DOCKER_USERNAME}/${APPLICATION_NAME}:${v}
	docker image rm ${DOCKER_USERNAME}/${APPLICATION_NAME}:${v}
