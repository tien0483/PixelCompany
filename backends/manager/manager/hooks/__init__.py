"""Hook scripts resolved from :func:`manager.data_paths.get_runtime_data_root`."""
from manager.data_paths import get_runtime_data_root

__path__ = [str(get_runtime_data_root() / "hooks")]
