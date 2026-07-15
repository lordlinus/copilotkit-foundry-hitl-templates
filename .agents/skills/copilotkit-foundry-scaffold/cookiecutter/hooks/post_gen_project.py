"""Print next-steps guidance after generating {{ cookiecutter.app_name }}."""
import os

# Cookiecutter runs post-gen hooks with cwd = the generated project directory,
# so this is the real path even when the caller passed a target dir.
APP_DIR = os.getcwd()

print()
print(f"✓ created {APP_DIR}")
print("  runtime agent name : {{ cookiecutter.app_name.replace('-', '_') }}")
print("  next:")
print(f"    1. cd {APP_DIR}")
print("    2. edit src/agent.py        (instructions + your read & approval-gated tools)")
print("    3. edit frontend/components/Chat.tsx  (render cards for your tools)")
print("    4. update scripts/smoke.py and frontend/e2e/hitl.spec.ts for those tools")
print("    5. make verify              (offline structural gate)")
print("    6. az login && azd auth login   (once — everything from here needs Azure)")
print("    7. make up                  (provision + deploy the hosted Foundry agent via azd)")
print("    8. azd ai agent run         (once, interactively at the app root — creates the")
print("                                 LOCAL azd env that make smoke/e2e/local need; Ctrl-C when ready)")
print("    9. make smoke && make e2e   (end-to-end HITL against the real agent, run locally)")
print("   10. make up-app              (deploy the bridge + frontend Container Apps via azd)")
print("   11. make verify-deployed     (proves a REAL active Foundry agent answers — required")
print("                                 before calling the app deployed/live)")
