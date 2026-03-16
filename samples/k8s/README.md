# Kubernetes-style sample logs (4 services, incident scenario)

Four log files simulating a cascading failure in a microservices stack.

## Scenario

1. **auth-service** – OOMKilled, CrashLoopBackOff
2. **api-gateway** – Connection refused to auth-service (4+ errors)
3. **order-service** – Timeout, connection refused, deadline exceeded
4. **payment-service** – Connection refused, connection pool exhausted

## Usage

```bash
# Batch analysis
solidx analyze samples/k8s/auth-service.log samples/k8s/api-gateway.log samples/k8s/order-service.log samples/k8s/payment-service.log

# Or use glob
solidx analyze samples/k8s/*.log

# Live mode (if files are being appended)
solidx analyze --live samples/k8s/*.log
```

## What solidx detects

- **Verdict:** INCIDENT DETECTED
- **Trigger:** auth-service crashloop (OOMKilled)
- **Signals:** connection refused, timeout, pool exhausted, retry burst, crash signature
- **Root cause candidates:** dependency timeout chain, service restart loop, connection refused
