#!/bin/bash
set -e
export KUBECONFIG=/home/ryan/.kube/config
exec kubectl --context=admin@deft1 port-forward -n qdrant svc/qdrant 6333:6333 --address=127.0.0.1
