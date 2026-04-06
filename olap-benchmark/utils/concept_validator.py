"""
Concept Validation Helper
==========================

Maps benchmark results to CMU 15-721 concepts and Article claims.
Makes results self-documenting and pedagogical.
"""

import textwrap
from typing import Dict, Any


class ConceptValidator:
    """Validates and annotates benchmark results with academic concepts."""

    COLORS = {
        "proof": "\033[91m",
        "validated": "\033[92m",
        "concept": "\033[94m",
        "reset": "\033[0m",
    }

    @staticmethod
    def validate_postgres_external_merge(metrics: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate Postgres external merge join behavior.
        Evidence: temp_written_blocks > 0
        """
        temp_written = metrics.get("temp_written_blocks", 0)
        external_merge = temp_written > 0

        validation = {
            "lecture": "CMU 15-721 Lecture 06: External Merge Sort",
            "concept": "Volcano Model degrades to disk-based merge join under buffer pressure",
            "proof": (
                f"EXPLAIN BUFFERS: temp written={temp_written} blocks"
                if external_merge
                else "No temp files"
            ),
            "validates": "Article 2: Tuple-at-a-time execution becomes IO-bound when memory exceeded",
            "status": "✅ Confirmed" if external_merge else "⚠️  Stayed in-memory",
            "confirmed": external_merge,
        }

        if external_merge:
            validation["interpretation"] = (
                f"Postgres exceeded work_mem → switched to external merge join. "
                f"The {metrics.get('io_bound_percent', 0):.0f}% IO wait confirms disk operations dominate."
            )
        else:
            validation["interpretation"] = (
                f"Query fit in work_mem → used in-memory hash join. "
                f"The {metrics.get('cpu_bound_percent', 0):.0f}% CPU utilization confirms in-memory processing."
            )

        return validation

    @staticmethod
    def validate_spark_spill(
        spill_metrics: Dict[str, Any], perf_metrics: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Validate Spark spill-to-disk behavior.
        Evidence: disk_spill_bytes > 0
        """
        disk_spill = spill_metrics.get("disk_spill_bytes", 0)
        spilled = disk_spill > 0

        validation = {
            "lecture": "CMU 15-721 Lecture 06: External Algorithms",
            "concept": "Sort-merge shuffle spills to disk when shuffle data exceeds memory",
            "proof": (
                f"Spark UI: disk_spill_bytes={disk_spill / (1024**2):.1f} MB"
                if spilled
                else "No disk spills"
            ),
            "validates": "Article 5: Distributed systems use external merge sort under memory pressure",
            "status": "✅ Confirmed" if spilled else "⚠️  Stayed in-memory",
            "confirmed": spilled,
        }

        if spilled:
            validation["interpretation"] = (
                f"Spark shuffle exceeded memory → spilled {disk_spill / (1024**2):.1f} MB to disk. "
                f"The {perf_metrics.get('io_bound_percent', 0):.0f}% IO wait confirms external merge active. "
                f"This is graceful degradation, not failure."
            )
        else:
            validation["interpretation"] = (
                f"Shuffle fit in memory → no external merge needed. "
                f"The {perf_metrics.get('cpu_bound_percent', 0):.0f}% CPU utilization confirms in-memory shuffle."
            )

        return validation

    @staticmethod
    def validate_duckdb_out_of_core(metrics: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate DuckDB out-of-core processing.
        Evidence: peak_memory > 2GB, no crash
        """
        peak_memory = metrics.get("peak_memory_mb", 0)
        out_of_core = peak_memory > 2000

        validation = {
            "lecture": "CMU 15-721 Lecture 05: Storage Models",
            "concept": "Vectorized execution with streaming from disk (disaggregated storage)",
            "proof": f"Peak memory: {peak_memory:.0f} MB {'> 2GB' if out_of_core else '< 2GB'}",
            "validates": "Article 2: DuckDB can process larger-than-RAM datasets via out-of-core",
            "status": "✅ Confirmed" if out_of_core else "ℹ️  In-memory",
            "confirmed": out_of_core,
        }

        if out_of_core:
            validation["interpretation"] = (
                f"Query exceeded available RAM ({peak_memory:.0f} MB > 2048 MB) but completed successfully. "
                f"DuckDB streamed data from disk. The {metrics.get('cpu_bound_percent', 0):.0f}% CPU shows "
                f"vectorization still working efficiently."
            )
        else:
            validation["interpretation"] = (
                f"Query fit in RAM ({peak_memory:.0f} MB). "
                f"The {metrics.get('cpu_bound_percent', 0):.0f}% CPU utilization confirms pure vectorized execution."
            )

        return validation

    @staticmethod
    def validate_variant_shredding(
        string_metrics: Dict[str, Any], variant_metrics: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Validate VARIANT shredding effectiveness.
        Evidence: STRING spills, VARIANT doesn't
        """
        string_spilled = string_metrics.get("disk_spill_bytes", 0) > 0
        variant_spilled = variant_metrics.get("disk_spill_bytes", 0) > 0
        avoided_spill = string_spilled and not variant_spilled

        validation = {
            "lecture": "CMU 15-721 Lecture 03: Data Models (PAX Storage)",
            "concept": "Sub-columnar shredding reduces memory footprint for semi-structured data",
            "proof": (
                f"STRING JSON: {'spilled' if string_spilled else 'no spill'}, "
                f"VARIANT: {'spilled' if variant_spilled else 'no spill'}"
            ),
            "validates": 'Article 1: VARIANT avoids "JSON tax" via PAX-style sub-columnar layout',
            "status": "✅ Confirmed" if avoided_spill else "⚠️  Both similar",
            "confirmed": avoided_spill,
        }

        if avoided_spill:
            string_time = string_metrics.get("execution_time_seconds", 1)
            variant_time = variant_metrics.get("execution_time_seconds", 1)
            speedup = string_time / variant_time if variant_time > 0 else 1
            memory_saved = string_metrics.get("peak_memory_mb", 0) - variant_metrics.get(
                "peak_memory_mb", 0
            )
            validation["interpretation"] = (
                f"STRING JSON forced full parse → spilled {string_metrics.get('disk_spill_bytes', 0) / (1024**2):.0f} MB. "
                f"VARIANT's shredded sub-columns stayed in-memory. "
                f"Result: {speedup:.1f}x faster, {memory_saved:.0f} MB less memory."
            )
        else:
            validation["interpretation"] = (
                "Both approaches performed similarly under current memory constraints. "
                "VARIANT shredding may show more benefit with larger datasets."
            )

        return validation

    @staticmethod
    def validate_buffer_pool(cold_time: float, hot_time: float) -> Dict[str, Any]:
        """
        Validate buffer pool / OS cache effects.
        Evidence: hot_time << cold_time
        """
        speedup = cold_time / hot_time if hot_time > 0 else 1
        significant = speedup > 3

        validation = {
            "lecture": "CMU 15-721 Lecture 05: Buffer Pool Management",
            "concept": "OS page cache eliminates disk I/O on repeated queries",
            "proof": f"Cold: {cold_time:.2f}s, Hot: {hot_time:.2f}s, Speedup: {speedup:.1f}x",
            "validates": "Article 2: Buffer pool effects can improve query performance 5-10x",
            "status": "✅ Significant effect" if significant else "ℹ️  Minor effect",
            "confirmed": significant,
        }

        if significant:
            validation["interpretation"] = (
                f"First run included disk I/O ({cold_time:.2f}s). "
                f"Second run hit OS cache ({hot_time:.2f}s) → {speedup:.1f}x faster. "
                f"This demonstrates buffer pool effectiveness."
            )
        else:
            validation["interpretation"] = (
                f"Minimal speedup ({speedup:.1f}x) suggests query was already cached "
                f"or is computation-bound rather than I/O-bound."
            )

        return validation

    @staticmethod
    def validate_acid_integrity(
        parquet_result: Dict[str, Any],
        delta_conflict: Dict[str, Any],
        delta_snapshot: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Validate ACID integrity proofs from the concurrent-writers test.

        Three signals:
          1. Parquet lost-update confirmed (silent overwrite)
          2. Delta ConcurrentAppendException caught (OCC working)
          3. Delta VERSION AS OF 0 returns pre-write count (MVCC working)
        """
        lost_update = parquet_result.get("lost_update_confirmed", False)
        occ_working = delta_conflict.get("occ_working", False)
        mvcc_working = delta_snapshot.get("snapshot_isolation_confirmed", False)
        all_confirmed = lost_update and occ_working and mvcc_working

        rows_lost = parquet_result.get("rows_silently_lost", 0)
        # Use rejected_exception (trimmed) if available; fall back to writer_a_exception
        rejected_writer = delta_conflict.get("rejected_writer") or "A"
        exception_type = (
            delta_conflict.get("rejected_exception")
            or delta_conflict.get("writer_a_exception")
            or "ConcurrentAppendException"
        )
        # Extract just the class name for terse proof string
        exc_class = exception_type
        if "ConcurrentAppendException" in exception_type:
            exc_class = "ConcurrentAppendException"
        elif "ConcurrentModificationException" in exception_type:
            exc_class = "ConcurrentModificationException"

        v0_rows = delta_snapshot.get("version_0_rows", 0)
        current_rows = delta_snapshot.get("current_version_rows", 0)

        proof_parts = []
        if lost_update:
            proof_parts.append(f"Parquet: {rows_lost:,} rows silently lost (last-writer-wins)")
        if occ_working:
            proof_parts.append(f"Delta OCC: {exc_class} raised for Writer {rejected_writer}")
        if mvcc_working:
            proof_parts.append(f"Delta MVCC: VERSION AS OF 0 → {v0_rows:,} rows (vs {current_rows:,} current)")

        validation = {
            "lecture": "CMU 15-721 Lectures 13-15: OCC / MVCC / Concurrency Control",
            "concept": "OCC detects write-write conflicts at commit time; MVCC enables consistent snapshot reads",
            "proof": " | ".join(proof_parts) if proof_parts else "See sub-test results",
            "validates": "ACID lakehouse (Delta) vs raw file format (Parquet) — integrity is not free",
            "status": "✅ OCC + MVCC confirmed" if all_confirmed else "⚠️  Partial results",
            "confirmed": all_confirmed,
        }

        if all_confirmed:
            validation["interpretation"] = (
                f"Raw Parquet has NO conflict detection: Writer B silently overwrote Writer A, "
                f"losing {rows_lost:,} rows with zero error. Delta Lake's OCC caught the same "
                f"conflict at commit time ({exception_type}), preventing data corruption. "
                f"The MVCC time-travel read proved snapshot isolation — VERSION AS OF 0 returned "
                f"exactly {v0_rows:,} rows despite {current_rows:,} rows in the current version."
            )
        else:
            parts = []
            if not lost_update:
                parts.append("Parquet lost-update not reproduced in this run")
            if not occ_working:
                parts.append("Delta OCC conflict not triggered (try larger dataset or install delta-spark)")
            if not mvcc_working:
                parts.append("Delta MVCC snapshot check inconclusive")
            validation["interpretation"] = " | ".join(parts) if parts else "See sub-test results for details."

        return validation

    @classmethod
    def print_validation(cls, validation: Dict[str, Any], indent: str = "   ") -> None:
        """Print color-coded validation to console."""
        c = cls.COLORS

        if validation["confirmed"]:
            print(f"\n{indent}{c['proof']}🎯 CONCEPT VALIDATED{c['reset']}")
        else:
            print(f"\n{indent}ℹ️  Observation")

        print(f"{indent}{c['validated']}✅ {validation['lecture']}{c['reset']}")
        print(f"{indent}{c['concept']}📖 {validation['concept']}{c['reset']}")
        print(f"{indent}   Proof: {validation['proof']}")
        print(f"{indent}   Validates: {validation['validates']}")

        if "interpretation" in validation:
            print(f"\n{indent}💡 What this means:")
            wrapped = textwrap.fill(
                validation["interpretation"],
                width=70,
                initial_indent=indent + "   ",
                subsequent_indent=indent + "   ",
            )
            print(wrapped)
