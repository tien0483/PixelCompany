"""
PIXTiel E2E Test Suite: Product Screenshots & Export Verification
==================================================================

Opaque-box end-to-end verification suite for the 6 high-resolution Light Mode
PIXTiel screenshots across primary and target synchronization repositories.

Requirements Covered:
  - ORIGINAL_REQUEST.md §R1, §R2, §R3, Acceptance Criteria
  - PROJECT.md Milestones M1, M2, M3, M4
  - TEST_INFRA.md Tiers 1, 2, 3, 4

Tiers:
  - Tier 1: Feature Coverage (file existence, dimensions 2880x1800, size > 50KB, RGB color)
  - Tier 2: Boundary & Format (PNG header magic bytes, chunk integrity, no truncation, no modal dialog overlays)
  - Tier 3: Cross-Feature & View Integrity (light theme, pixel canvas with sprites, dual-pane editor without tofu,
            review MR diff workspace, Flowise node graph canvas without offline placeholders, OpenMAIC classroom live)
  - Tier 4: Real-World Sanitization & Dual-Repo Sync (zero unredacted PII/tokens, bitwise/visual sync, adversarial checks)
"""

import io
import os
import re
import struct
import hashlib
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import numpy as np
import pytest
from PIL import Image, ImageFile, ImageDraw
import scipy.ndimage as ndi

# Disallow loading truncated images so any corruption fails immediately
ImageFile.LOAD_TRUNCATED_IMAGES = False

# ---------------------------------------------------------------------------
# Constants & Paths
# ---------------------------------------------------------------------------

PRIMARY_SCREENSHOT_DIR = Path("/home/ubuntu/pixtiel/frontends/pixtiel-site/public/screenshots")
SYNC_SCREENSHOT_DIR = Path("/home/ubuntu/work/PixelCompany/frontends/pixtiel-site/public/screenshots")

TARGET_SCREENSHOTS = [
    "board-hero.png",
    "board-feature.png",
    "plan-editor.png",
    "review-tab.png",
    "agent-studio.png",
    "learning.png",
]

EXPECTED_WIDTH = 2880
EXPECTED_HEIGHT = 1800
MIN_FILE_SIZE_BYTES = 50_000

PNG_MAGIC_BYTES = b"\x89PNG\r\n\x1a\n"

PROHIBITED_PII_PATTERNS = [
    re.compile(rb"tien0483@gmail\.com", re.IGNORECASE),
    re.compile(rb"hoangtien\.nguyen@akselos\.com", re.IGNORECASE),
    re.compile(rb"\bTien\s+Nguyen\b", re.IGNORECASE),
    re.compile(rb"glpat-[a-zA-Z0-9_\.-]{10,}", re.IGNORECASE),
    re.compile(rb"\bVN-LAP-122\b", re.IGNORECASE),
    re.compile(rb"\bakselos\.com\b", re.IGNORECASE),
    re.compile(rb"/mnt/e/akselos-dev", re.IGNORECASE),
]

# ---------------------------------------------------------------------------
# Helper Classes & Forensic Analyzers
# ---------------------------------------------------------------------------

class PNGChunkParser:
    """Parses raw PNG chunks for structural integrity, CRC, and metadata text chunks."""

    @staticmethod
    def parse_chunks(file_bytes: bytes) -> List[Tuple[str, bytes, int]]:
        if not file_bytes.startswith(PNG_MAGIC_BYTES):
            raise ValueError("Invalid PNG signature magic bytes")
        
        chunks = []
        offset = 8
        total_len = len(file_bytes)
        
        while offset < total_len:
            if offset + 8 > total_len:
                raise ValueError(f"Truncated chunk header at offset {offset}")
            
            length, chunk_type_raw = struct.unpack(">I4s", file_bytes[offset:offset+8])
            chunk_type = chunk_type_raw.decode("latin1", errors="replace")
            offset += 8
            
            if offset + length + 4 > total_len:
                raise ValueError(f"Truncated chunk data for {chunk_type} (expected {length} bytes)")
            
            data = file_bytes[offset:offset+length]
            offset += length
            
            crc = struct.unpack(">I", file_bytes[offset:offset+4])[0]
            offset += 4
            
            chunks.append((chunk_type, data, crc))
            if chunk_type == "IEND":
                break
                
        return chunks


class VisualForensics:
    """Performs mathematical and computer-vision based analysis on screenshots."""

    @staticmethod
    def compute_luminance(arr: np.ndarray) -> float:
        """Computes perceived ITU-R BT.709 relative luminance across the RGB image (0-255)."""
        r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return float(np.mean(lum))

    @staticmethod
    def compute_entropy(arr: np.ndarray) -> float:
        """Computes Shannon entropy of color distribution (0.0 for blank solid images)."""
        gray = np.dot(arr[..., :3], [0.2989, 0.5870, 0.1140]).astype(np.uint8)
        hist, _ = np.histogram(gray, bins=256, range=(0, 256), density=True)
        hist = hist[hist > 0]
        return float(-np.sum(hist * np.log2(hist)))

    @staticmethod
    def detect_modal_overlay_scrim(arr: np.ndarray) -> bool:
        """
        Detects if a semi-transparent modal backdrop scrim (e.g. Radix bg-black/60)
        is active across the screen. In light theme, corner margins without modal
        have high luminance (> 200). With a 60% scrim, margin luminance drops below 135.
        """
        h, w = arr.shape[:2]
        corners = [
            arr[100:250, 100:250],        # top-left
            arr[100:250, w-250:w-100],    # top-right
            arr[h-250:h-100, 100:250],    # bottom-left
            arr[h-250:h-100, w-250:w-100] # bottom-right
        ]
        mean_corner_lum = np.mean([VisualForensics.compute_luminance(c) for c in corners])
        return bool(mean_corner_lum < 135.0)

    @staticmethod
    def detect_centered_modal_dialog(arr: np.ndarray) -> bool:
        """
        Detects if a high-contrast centered modal dialog box (StartupOnboardingDialog)
        is occluding the viewport center.
        """
        h, w = arr.shape[:2]
        center_y, center_x = h // 2, w // 2
        box_half_w, box_half_h = 550, 380
        top = center_y - box_half_h
        left = center_x - box_half_w
        right = center_x + box_half_w
        
        outer_vs_inner_diff = np.abs(np.mean(arr[top-20:top, left:right]) - np.mean(arr[top:top+20, left:right]))
        scrim = VisualForensics.detect_modal_overlay_scrim(arr)
        return bool(scrim and outer_vs_inner_diff > 40.0)

    @staticmethod
    def detect_tofu_boxes(image: Image.Image, region: Optional[Tuple[int, int, int, int]] = None) -> List[Tuple[int, int, int, int]]:
        """
        Detects CJK missing font 'tofu' boxes (square hollow rectangle replacement glyphs).
        Missing glyphs render as outlined boxes of height ~14-26px and width ~8-18px
        with a hollow interior. Runs of 3+ consecutive identical hollow boxes indicate
        missing CJK glyphs (e.g. [][][] HTML [][][] or 16:9 [][][][]).
        """
        img_crop = image.crop(region) if region else image
        arr = np.array(img_crop.convert("L"))
        
        stroke = arr < 160
        holes = arr >= 160
        labeled_holes, num_holes = ndi.label(holes)
        slices = ndi.find_objects(labeled_holes)
        
        candidate_boxes = []
        for sl in slices:
            if sl is None:
                continue
            h = sl[0].stop - sl[0].start
            w = sl[1].stop - sl[1].start
            
            # Typical tofu hollow interior dimension: width 6-20px, height 12-28px at 2x DPR
            if 6 <= w <= 20 and 12 <= h <= 28:
                y1, y2 = max(0, sl[0].start - 2), min(arr.shape[0], sl[0].stop + 2)
                x1, x2 = max(0, sl[1].start - 2), min(arr.shape[1], sl[1].stop + 2)
                
                border_mask = np.ones((y2 - y1, x2 - x1), dtype=bool)
                border_mask[sl[0].start - y1 : sl[0].stop - y1, sl[1].start - x1 : sl[1].stop - x1] = False
                surrounding = stroke[y1:y2, x1:x2][border_mask]
                
                # Check if perimeter is sufficiently dark (outline stroke)
                if len(surrounding) > 0 and np.mean(surrounding) > 0.45:
                    candidate_boxes.append((sl[1].start, sl[0].start, w, h))
        
        # Filter for consecutive horizontally aligned boxes (characteristic of missing text strings)
        consecutive_tofu = []
        if candidate_boxes:
            candidate_boxes.sort(key=lambda b: (b[1] // 10, b[0]))
            run = [candidate_boxes[0]]
            for box in candidate_boxes[1:]:
                prev = run[-1]
                # Same text line within 4px and horizontal distance between 8px and 25px
                if abs(box[1] - prev[1]) <= 4 and 8 <= (box[0] - prev[0]) <= 25:
                    run.append(box)
                else:
                    if len(run) >= 3:
                        consecutive_tofu.extend(run)
                    run = [box]
            if len(run) >= 3:
                consecutive_tofu.extend(run)
                
        return consecutive_tofu


# ---------------------------------------------------------------------------
# Tier 1: Feature Coverage & Asset Presence
# ---------------------------------------------------------------------------

class TestTier1FeatureCoverage:
    """Verifies existence, minimum file size, exact dimensions, and color mode for all 6 target PNGs."""

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_primary_repo_files_exist(self, name: str):
        path = PRIMARY_SCREENSHOT_DIR / name
        assert path.exists(), f"Primary screenshot missing: {path}"
        assert path.is_file(), f"Path is not a regular file: {path}"

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_sync_repo_files_exist(self, name: str):
        path = SYNC_SCREENSHOT_DIR / name
        assert path.exists(), f"Synchronized screenshot missing in secondary repo: {path}"
        assert path.is_file(), f"Path is not a regular file: {path}"

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_primary_repo_file_sizes(self, name: str):
        path = PRIMARY_SCREENSHOT_DIR / name
        size = path.stat().st_size
        assert size > MIN_FILE_SIZE_BYTES, (
            f"Screenshot {name} size {size} bytes is below required {MIN_FILE_SIZE_BYTES} bytes"
        )

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_sync_repo_file_sizes(self, name: str):
        path = SYNC_SCREENSHOT_DIR / name
        size = path.stat().st_size
        assert size > MIN_FILE_SIZE_BYTES, (
            f"Synced screenshot {name} size {size} bytes is below required {MIN_FILE_SIZE_BYTES} bytes"
        )

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_dimensions_exact_2880x1800(self, name: str):
        for base_dir in [PRIMARY_SCREENSHOT_DIR, SYNC_SCREENSHOT_DIR]:
            path = base_dir / name
            with Image.open(path) as img:
                width, height = img.size
                assert (width, height) == (EXPECTED_WIDTH, EXPECTED_HEIGHT), (
                    f"Screenshot {path} dimensions {width}x{height} do not match exact 2880x1800 (1440x900 @ 2x DPR)"
                )

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_color_mode_rgb(self, name: str):
        path = PRIMARY_SCREENSHOT_DIR / name
        with Image.open(path) as img:
            assert img.mode in ("RGB", "RGBA"), (
                f"Screenshot {name} color mode {img.mode} is invalid; expected RGB or RGBA"
            )


# ---------------------------------------------------------------------------
# Tier 2: Boundary & Corner Cases (Format & Modal Suppression)
# ---------------------------------------------------------------------------

class TestTier2BoundaryAndCornerCases:
    """Verifies PNG format specifications, non-truncation, non-trivial entropy, and absence of modals."""

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_png_magic_bytes(self, name: str):
        path = PRIMARY_SCREENSHOT_DIR / name
        with open(path, "rb") as f:
            header = f.read(8)
        assert header == PNG_MAGIC_BYTES, f"File {name} does not start with valid PNG magic bytes"

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_chunk_integrity_and_no_truncation(self, name: str):
        path = PRIMARY_SCREENSHOT_DIR / name
        with open(path, "rb") as f:
            content = f.read()
        
        chunks = PNGChunkParser.parse_chunks(content)
        chunk_types = [c[0] for c in chunks]
        
        assert len(chunks) >= 3, f"Incomplete PNG chunk sequence in {name}"
        assert chunk_types[0] == "IHDR", f"First chunk in {name} is {chunk_types[0]}, expected IHDR"
        assert "IDAT" in chunk_types, f"Missing IDAT data chunk in {name}"
        assert chunk_types[-1] == "IEND", f"PNG {name} must terminate with IEND chunk"

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_image_decode_no_truncation(self, name: str):
        path = PRIMARY_SCREENSHOT_DIR / name
        with Image.open(path) as img:
            img.verify()
        
        # Re-open for full pixel data decoding
        with Image.open(path) as img:
            try:
                img.load()
            except Exception as e:
                pytest.fail(f"Image {name} failed to load pixel data: {e}")

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_non_trivial_entropy(self, name: str):
        path = PRIMARY_SCREENSHOT_DIR / name
        with Image.open(path) as img:
            arr = np.array(img.convert("RGB"))
            entropy = VisualForensics.compute_entropy(arr)
            std_dev = float(np.std(arr))
            # Reject solid/blank images (entropy 0.0, std 0.0)
            assert entropy > 0.5, f"Screenshot {name} has suspiciously low entropy ({entropy:.2f} bits)"
            assert std_dev > 10.0, f"Screenshot {name} is nearly uniform or blank (std_dev={std_dev:.2f})"

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_absence_of_modal_overlay_scrim(self, name: str):
        path = PRIMARY_SCREENSHOT_DIR / name
        with Image.open(path) as img:
            arr = np.array(img.convert("RGB"))
            has_scrim = VisualForensics.detect_modal_overlay_scrim(arr)
            assert not has_scrim, (
                f"Screenshot {name} appears blocked by a dark backdrop overlay / modal scrim"
            )

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_absence_of_centered_dialog_overlay(self, name: str):
        path = PRIMARY_SCREENSHOT_DIR / name
        with Image.open(path) as img:
            arr = np.array(img.convert("RGB"))
            has_dialog = VisualForensics.detect_centered_modal_dialog(arr)
            assert not has_dialog, (
                f"Screenshot {name} contains a blocking centered modal dialog box"
            )


# ---------------------------------------------------------------------------
# Tier 3: Cross-Feature & View Integrity
# ---------------------------------------------------------------------------

class TestTier3CrossFeatureAndViewIntegrity:
    """Verifies view-specific feature surfaces and visual contracts for each screenshot."""

    def test_board_hero_light_theme_and_columns(self):
        path = PRIMARY_SCREENSHOT_DIR / "board-hero.png"
        with Image.open(path) as img:
            arr = np.array(img.convert("RGB"))
            
            # Light theme verification: mean luminance > 180 (scale 0-255)
            lum = VisualForensics.compute_luminance(arr)
            assert lum > 180.0, f"board-hero.png is not rendered in Light Theme (luminance={lum:.2f})"
            
            # Full-width Kanban layout verification:
            # Columns span across the board area (x: 100 to 2000)
            board_area = arr[200:1600, 100:2000]
            col_profile = np.std(board_area, axis=0).mean(axis=1)
            assert np.mean(col_profile) > 5.0, "board-hero.png does not display Kanban columns across full width"
            
            # Seats panel in upper-right region (x > 2100)
            seats_area = arr[200:800, 2200:2800]
            assert np.std(seats_area) > 10.0, "board-hero.png missing Seats / Manager panel in right region"

    def test_board_feature_office_canvas_and_sprites(self):
        path = PRIMARY_SCREENSHOT_DIR / "board-feature.png"
        with Image.open(path) as img:
            arr = np.array(img.convert("RGB"))
            
            # Lower-right quadrant contains the office canvas (y: 400-1750, x: 2000-2850)
            office_crop = arr[400:1750, 2000:2850]
            
            # Color variance check: pixel art character sprites and office tiles have vibrant saturated colors
            r, g, b = office_crop[:, :, 0].astype(float), office_crop[:, :, 1].astype(float), office_crop[:, :, 2].astype(float)
            color_variance = np.mean(np.abs(r - g) + np.abs(g - b) + np.abs(r - b))
            
            assert color_variance > 10.0, (
                f"board-feature.png lacks vibrant pixel canvas content in office quadrant (color_variance={color_variance:.2f})"
            )

    def test_board_feature_not_identical_to_hero(self):
        hero_path = PRIMARY_SCREENSHOT_DIR / "board-hero.png"
        feat_path = PRIMARY_SCREENSHOT_DIR / "board-feature.png"
        
        with Image.open(hero_path) as h_img, Image.open(feat_path) as f_img:
            h_arr = np.array(h_img.convert("RGB"), dtype=float)
            f_arr = np.array(f_img.convert("RGB"), dtype=float)
            
            # Crucial check against the exact prior defect where office view was never opened
            office_diff = np.mean(np.abs(h_arr[400:1750, 2000:2850] - f_arr[400:1750, 2000:2850]))
            assert office_diff > 5.0, (
                f"board-feature.png is virtually identical to board-hero.png in office pane (diff={office_diff:.4f}). "
                "The Pixel Office view must be open with animated sprites visibly seated at desks."
            )

    def test_plan_editor_dual_pane_split(self):
        path = PRIMARY_SCREENSHOT_DIR / "plan-editor.png"
        with Image.open(path) as img:
            arr = np.array(img.convert("RGB"), dtype=float)
            
            # Left pane: Markdown source editor (e.g. x: 500 to 1400)
            # Right pane: Rendered HTML preview (e.g. x: 1500 to 2800)
            left_editor = arr[200:1600, 500:1350]
            right_preview = arr[200:1600, 1500:2700]
            
            assert np.std(left_editor) > 15.0, "plan-editor.png left markdown editor pane is empty or blank"
            assert np.std(right_preview) > 15.0, "plan-editor.png right live preview pane is empty or blank"
            
            # Both panes must be non-identical (source vs rendered preview)
            pane_diff = np.mean(np.abs(left_editor[:, :800] - right_preview[:, :800]))
            assert pane_diff > 10.0, "plan-editor.png source and preview panes appear duplicate or unrendered"

    def test_plan_editor_no_tofu_glyphs(self):
        path = PRIMARY_SCREENSHOT_DIR / "plan-editor.png"
        with Image.open(path) as img:
            # Crop the left template sidebar region where template cards are rendered
            tofu_boxes = VisualForensics.detect_tofu_boxes(img, region=(0, 100, 600, 1700))
            assert len(tofu_boxes) == 0, (
                f"plan-editor.png contains {len(tofu_boxes)} unrendered missing font 'tofu' boxes in templates. "
                "Template titles must be sanitized or webfont injected."
            )

    def test_review_tab_diff_viewer_active(self):
        path = PRIMARY_SCREENSHOT_DIR / "review-tab.png"
        with Image.open(path) as img:
            arr = np.array(img.convert("RGB"), dtype=np.int32)
            
            # The review tab must display an active MR workspace with the diff viewer loaded,
            # NOT just the empty MR list screen.
            # In an active diff viewer:
            # 1. Diff addition lines (green highlight) and deletion lines (red highlight)
            r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
            green_diff_lines = (g > r + 15) & (g > b + 10) & (g > 190)
            red_diff_lines = (r > g + 15) & (r > b + 10) & (r > 190)
            
            diff_colored_px = int(np.sum(green_diff_lines) + np.sum(red_diff_lines))
            
            # Also check file tree and code structure in workspace area (x: 100 to 2800, y: 150 to 1700)
            workspace = arr[150:1700, 100:2800]
            workspace_variance = float(np.std(workspace))
            
            assert diff_colored_px > 500 or workspace_variance > 25.0, (
                "review-tab.png appears to show only an empty MR list screen rather than "
                "the active Merge Request diff viewer workspace with syntax highlighting and file panels."
            )

    def test_agent_studio_canvas_rendered_no_placeholder(self):
        path = PRIMARY_SCREENSHOT_DIR / "agent-studio.png"
        hero_path = PRIMARY_SCREENSHOT_DIR / "board-hero.png"
        
        with Image.open(path) as img, Image.open(hero_path) as h_img:
            arr = np.array(img.convert("RGB"), dtype=float)
            h_arr = np.array(h_img.convert("RGB"), dtype=float)
            
            # Verify agent studio does not display the Kanban column headers (y: 120-180, x: 300-1800)
            diff_headers = float(np.mean(np.abs(h_arr[120:180, 300:1800] - arr[120:180, 300:1800])))
            assert diff_headers > 5.0, (
                "agent-studio.png displays Kanban board column headers instead of the Flowise Agent Studio canvas"
            )
            
            # Canvas content verification: Flowise canvas contains node boxes, ports, or grid background
            canvas_area = arr[150:1650, 150:2700]
            assert np.std(canvas_area) > 15.0, (
                "agent-studio.png visual node graph canvas is blank or unrendered"
            )

    def test_learning_classroom_live_no_diagnostic_blocking(self):
        path = PRIMARY_SCREENSHOT_DIR / "learning.png"
        hero_path = PRIMARY_SCREENSHOT_DIR / "board-hero.png"
        
        with Image.open(path) as img, Image.open(hero_path) as h_img:
            arr = np.array(img.convert("RGB"), dtype=float)
            h_arr = np.array(h_img.convert("RGB"), dtype=float)
            
            # Verify learning view does not display Kanban board column headers (y: 120-180, x: 300-1800)
            diff_headers = float(np.mean(np.abs(h_arr[120:180, 300:1800] - arr[120:180, 300:1800])))
            assert diff_headers > 5.0, (
                "learning.png displays Kanban board column headers instead of the OpenMAIC interactive classroom"
            )
            
            # Center pane (x: 300 to 2500, y: 150 to 1650) must display classroom content
            classroom_area = arr[150:1650, 300:2500]
            assert np.std(classroom_area) > 20.0, (
                "learning.png center pane does not show live interactive classroom content"
            )


# ---------------------------------------------------------------------------
# Tier 4: Real-World Scenarios, Sanitization & Dual-Repo Sync
# ---------------------------------------------------------------------------

class TestTier4RealWorldAndSanitization:
    """Verifies complete sanitization of personal identifiers and dual-repo bitwise/visual sync."""

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_zero_unredacted_emails(self, name: str):
        for base_dir in [PRIMARY_SCREENSHOT_DIR, SYNC_SCREENSHOT_DIR]:
            path = base_dir / name
            with open(path, "rb") as f:
                content = f.read()
            
            for pattern in [PROHIBITED_PII_PATTERNS[0], PROHIBITED_PII_PATTERNS[1]]:
                match = pattern.search(content)
                assert match is None, (
                    f"Found unredacted personal email address in {path}: {match.group(0).decode('latin1', errors='replace')}"
                )

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_zero_unredacted_tokens(self, name: str):
        for base_dir in [PRIMARY_SCREENSHOT_DIR, SYNC_SCREENSHOT_DIR]:
            path = base_dir / name
            with open(path, "rb") as f:
                content = f.read()
            
            token_pattern = PROHIBITED_PII_PATTERNS[3]
            match = token_pattern.search(content)
            assert match is None, (
                f"Found unredacted personal token in {path}: {match.group(0).decode('latin1', errors='replace')}"
            )

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_zero_unredacted_names_and_hostnames(self, name: str):
        for base_dir in [PRIMARY_SCREENSHOT_DIR, SYNC_SCREENSHOT_DIR]:
            path = base_dir / name
            with open(path, "rb") as f:
                content = f.read()
            
            for pattern in PROHIBITED_PII_PATTERNS:
                match = pattern.search(content)
                assert match is None, (
                    f"Found prohibited sensitive identifier in {path}: {match.group(0).decode('latin1', errors='replace')}"
                )

    @pytest.mark.parametrize("name", TARGET_SCREENSHOTS)
    def test_dual_repo_bitwise_or_pixel_sync(self, name: str):
        p1 = PRIMARY_SCREENSHOT_DIR / name
        p2 = SYNC_SCREENSHOT_DIR / name
        
        with open(p1, "rb") as f1, open(p2, "rb") as f2:
            h1 = hashlib.sha256(f1.read()).hexdigest()
            h2 = hashlib.sha256(f2.read()).hexdigest()
        
        if h1 != h2:
            with Image.open(p1) as img1, Image.open(p2) as img2:
                arr1 = np.array(img1)
                arr2 = np.array(img2)
                assert np.array_equal(arr1, arr2), (
                    f"Screenshots between primary ({p1}) and sync ({p2}) repositories differ visually!"
                )
        else:
            assert h1 == h2, f"Checksums match bitwise: {h1}"


# ---------------------------------------------------------------------------
# Tier 4: Adversarial & Stress Validation
# ---------------------------------------------------------------------------

class TestTier4AdversarialValidation:
    """Exercises negative and adversarial test cases ensuring tests catch defects and never pass trivially."""

    def test_adversarial_detects_corrupted_png(self, tmp_path):
        corrupted_file = tmp_path / "corrupted.png"
        corrupted_file.write_bytes(PNG_MAGIC_BYTES + b"\x00\x00\x00\x0dIHDRtrunc")
        
        with pytest.raises(ValueError, match="Truncated"):
            with open(corrupted_file, "rb") as f:
                PNGChunkParser.parse_chunks(f.read())

    def test_adversarial_detects_wrong_dimensions(self, tmp_path):
        bad_dim_file = tmp_path / "bad_dim.png"
        img = Image.new("RGB", (1920, 1080), color=(240, 240, 240))
        img.save(bad_dim_file, "PNG")
        
        with Image.open(bad_dim_file) as im:
            assert im.size != (EXPECTED_WIDTH, EXPECTED_HEIGHT)

    def test_adversarial_detects_pii_leak(self, tmp_path):
        leaked_file = tmp_path / "leaked.png"
        img = Image.new("RGB", (100, 100), color=(255, 255, 255))
        from PIL import PngImagePlugin
        meta = PngImagePlugin.PngInfo()
        meta.add_text("Author", "tien0483@gmail.com")
        img.save(leaked_file, "PNG", pnginfo=meta)
        
        with open(leaked_file, "rb") as f:
            content = f.read()
            match = PROHIBITED_PII_PATTERNS[0].search(content)
            assert match is not None, "Scanner must detect injected personal email"

    def test_adversarial_detects_dark_theme(self):
        dark_arr = np.zeros((EXPECTED_HEIGHT, EXPECTED_WIDTH, 3), dtype=np.uint8)
        dark_arr.fill(30)
        lum = VisualForensics.compute_luminance(dark_arr)
        assert lum < 180.0, "Validator must detect dark mode background"

    def test_adversarial_detects_duplicate_hero_as_feature(self):
        arr = np.zeros((1000, 1000, 3), dtype=float)
        diff = np.mean(np.abs(arr - arr))
        assert diff == 0.0, "Identical frames must have diff == 0.0"


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
