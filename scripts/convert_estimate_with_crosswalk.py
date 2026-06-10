from __future__ import annotations

import argparse
import csv
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

DEFAULT_CROSSWALK = Path("catalog_lookup_crosswalk.csv")
DEFAULT_OUTPUT = Path("estimate_converted.csv")
DEFAULT_UNMATCHED_OUTPUT = Path("estimate_unmatched.csv")

COST_CODE_CANDIDATES = [
    "Cost Code",
    "cost_code",
    "cost code",
    "CostCode",
    "costCode",
]

ITEM_ID_CANDIDATES = [
    "ItemId",
    "Item ID",
    "item_id",
    "item id",
    "Line Item Type ID",
    "line_item_type_id",
]


def normalize(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def build_key(cost_code: object, item_id: object) -> str:
    return f"{normalize(cost_code)}|{normalize(item_id)}"


def choose_column(headers: Iterable[str], candidates: List[str], explicit: str | None, label: str) -> str:
    header_list = list(headers)

    if explicit:
        if explicit not in header_list:
            raise ValueError(f"Column '{explicit}' not found for {label}. Available columns: {header_list}")
        return explicit

    lowered = {h.lower(): h for h in header_list}
    for candidate in candidates:
        if candidate in header_list:
            return candidate
        hit = lowered.get(candidate.lower())
        if hit:
            return hit

    raise ValueError(
        f"Unable to auto-detect {label} column. Provide --{label}-column. Available columns: {header_list}"
    )


def load_crosswalk(crosswalk_path: Path) -> Dict[str, Dict[str, str]]:
    if not crosswalk_path.exists():
        raise FileNotFoundError(f"Crosswalk not found: {crosswalk_path}")

    mapping: Dict[str, Dict[str, str]] = {}
    with crosswalk_path.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        required = {"OldUniqueKey", "NewUniqueKey", "NewCostCode", "NewItemId"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Crosswalk missing required columns: {sorted(missing)}")

        for row in reader:
            old_key = normalize(row.get("OldUniqueKey"))
            if not old_key:
                continue
            if old_key not in mapping:
                mapping[old_key] = {
                    "NewUniqueKey": normalize(row.get("NewUniqueKey")),
                    "NewCostCode": normalize(row.get("NewCostCode")),
                    "NewItemId": normalize(row.get("NewItemId")),
                }

    return mapping


def convert_estimate(
    estimate_path: Path,
    crosswalk: Dict[str, Dict[str, str]],
    output_path: Path,
    unmatched_output_path: Path,
    cost_code_column: str | None,
    item_id_column: str | None,
) -> Tuple[int, int]:
    if not estimate_path.exists():
        raise FileNotFoundError(f"Estimate CSV not found: {estimate_path}")

    with estimate_path.open("r", newline="", encoding="utf-8-sig") as infile:
        reader = csv.DictReader(infile)
        headers = list(reader.fieldnames or [])
        if not headers:
            raise ValueError("Estimate CSV has no header row.")

        cost_col = choose_column(headers, COST_CODE_CANDIDATES, cost_code_column, "cost-code")
        item_col = choose_column(headers, ITEM_ID_CANDIDATES, item_id_column, "item-id")

        augmented_headers = headers + ["OldUniqueKey", "NewUniqueKey", "ConversionStatus"]

        matched_rows = 0
        unmatched_rows = 0

        with output_path.open("w", newline="", encoding="utf-8") as out_f, unmatched_output_path.open(
            "w", newline="", encoding="utf-8"
        ) as unmatched_f:
            out_writer = csv.DictWriter(out_f, fieldnames=augmented_headers)
            unmatched_writer = csv.DictWriter(unmatched_f, fieldnames=augmented_headers)
            out_writer.writeheader()
            unmatched_writer.writeheader()

            for row in reader:
                old_key = build_key(row.get(cost_col), row.get(item_col))
                mapping = crosswalk.get(old_key)

                row["OldUniqueKey"] = old_key

                if mapping:
                    # Keep source values when crosswalk replacement fields are blank.
                    if mapping["NewCostCode"]:
                        row[cost_col] = mapping["NewCostCode"]
                    if mapping["NewItemId"]:
                        row[item_col] = mapping["NewItemId"]
                    row["NewUniqueKey"] = mapping["NewUniqueKey"]
                    row["ConversionStatus"] = "MATCHED"
                    matched_rows += 1
                else:
                    row["NewUniqueKey"] = ""
                    row["ConversionStatus"] = "UNMATCHED"
                    unmatched_rows += 1
                    unmatched_writer.writerow(row)

                out_writer.writerow(row)

    return matched_rows, unmatched_rows


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert old estimate CSV cost codes and item IDs to new values using catalog crosswalk."
    )
    parser.add_argument("estimate_csv", help="Path to old estimate CSV export to convert.")
    parser.add_argument(
        "--crosswalk",
        default=str(DEFAULT_CROSSWALK),
        help=f"Path to crosswalk CSV (default: {DEFAULT_CROSSWALK}).",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help=f"Path for converted output CSV (default: {DEFAULT_OUTPUT}).",
    )
    parser.add_argument(
        "--unmatched-output",
        default=str(DEFAULT_UNMATCHED_OUTPUT),
        help=f"Path for unmatched-only CSV (default: {DEFAULT_UNMATCHED_OUTPUT}).",
    )
    parser.add_argument(
        "--cost-code-column",
        default=None,
        help="Optional explicit source estimate cost code column name.",
    )
    parser.add_argument(
        "--item-id-column",
        default=None,
        help="Optional explicit source estimate item ID column name.",
    )

    return parser.parse_args()


def main() -> None:
    args = parse_args()

    estimate_path = Path(args.estimate_csv)
    crosswalk_path = Path(args.crosswalk)
    output_path = Path(args.output)
    unmatched_output_path = Path(args.unmatched_output)

    crosswalk = load_crosswalk(crosswalk_path)
    matched, unmatched = convert_estimate(
        estimate_path=estimate_path,
        crosswalk=crosswalk,
        output_path=output_path,
        unmatched_output_path=unmatched_output_path,
        cost_code_column=args.cost_code_column,
        item_id_column=args.item_id_column,
    )

    print(f"Converted CSV: {output_path}")
    print(f"Unmatched CSV: {unmatched_output_path}")
    print(f"Rows matched: {matched}")
    print(f"Rows unmatched: {unmatched}")


if __name__ == "__main__":
    main()
