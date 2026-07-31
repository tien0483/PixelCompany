"""Cursor provider — read-only usage + manual-only account switching.

Auto-swap is permanently disabled (see ``jacked.providers``): Cursor stores
its session in the IDE's state database, which the running app holds open.
"""
