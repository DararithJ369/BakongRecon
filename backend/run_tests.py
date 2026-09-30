"""
Test runner for BakongRecon test suite using standard Python.
Runs all test files in the tests/ directory.
"""
import sys
import inspect
import traceback
from pathlib import Path

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import tests.test_parser as test_parser
import tests.test_receipt_verifier as test_receipt_verifier
import tests.test_analytics as test_analytics
import tests.test_api as test_api

TEST_MODULES = [
    test_parser,
    test_receipt_verifier,
    test_analytics,
    test_api,
]


def run_all():
    passed = 0
    failed = 0
    errors = []

    print("=" * 60)
    print("Running BakongRecon Automated Test Suite")
    print("=" * 60)

    for mod in TEST_MODULES:
        mod_name = mod.__name__.split(".")[-1]
        print(f"\n📂 Module: {mod_name}")
        for attr_name in dir(mod):
            if attr_name.startswith("test_") and callable(getattr(mod, attr_name)):
                fn = getattr(mod, attr_name)
                # Check if it takes arguments/fixtures
                sig = inspect.signature(fn)
                params = list(sig.parameters.keys())
                
                try:
                    if not params:
                        fn()
                    elif "name" in params and hasattr(fn, "pytestmark"):
                        # pytest parameterized
                        names = [
                            "PATRICK", "JONATHAN", "SIMON", "ANTON",
                            "BEATRIX", "SOK CHEAT", "BOPHA TELECOM", "សុខ សាន"
                        ]
                        for n in names:
                            fn(n)
                    elif "db_session" in params:
                        gen = mod.db_session()
                        sess = next(gen)
                        try:
                            fn(sess)
                        finally:
                            try:
                                next(gen)
                            except StopIteration:
                                pass
                    elif "client" in params:
                        gen = mod.client()
                        c = next(gen)
                        try:
                            fn(c)
                        finally:
                            try:
                                next(gen)
                            except StopIteration:
                                pass
                    else:
                        fn()
                    print(f"  ✅ {attr_name}")
                    passed += 1
                except Exception as e:
                    print(f"  ❌ {attr_name}: {e}")
                    traceback.print_exc()
                    failed += 1
                    errors.append((mod_name, attr_name, str(e)))

    print("\n" + "=" * 60)
    print(f"Summary: {passed} passed, {failed} failed")
    print("=" * 60)

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    run_all()
