import { useMemo, useState } from "react";
import type {
  Job,
  SortOption,
  TimeFilter,
  TimePreference,
  VehicleMobility,
} from "../lib/types";

/**
 * Filtry a řazení poptávek na domovské obrazovce řidiče.
 * Vyextractováno 1:1 z App.tsx — chování beze změny.
 */
export function useJobFilters(jobs: Job[]) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");
  const [mobilityFilter, setMobilityFilter] = useState<VehicleMobility | "all">("all");
  const [sortOption, setSortOption] = useState<SortOption>("urgent");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const filteredJobs = useMemo(() => {
    const timePriority: Record<TimePreference, number> = {
      asap: 0,
      within_24h: 1,
      within_3_days: 2,
      within_week: 3,
      specific: 4,
    };

    return jobs
      .filter((job) => job.status === "open")
      .filter((job) => timeFilter === "all" || job.timePreference === timeFilter)
      .filter((job) => vehicleFilter === "all" || job.vehicle === vehicleFilter)
      .filter((job) => mobilityFilter === "all" || job.vehicleMobility === mobilityFilter)
      .sort((firstJob, secondJob) => {
        if (sortOption === "newest") {
          return (Date.parse(secondJob.createdAt || "") || 0) - (Date.parse(firstJob.createdAt || "") || 0);
        }

        const priorityDifference =
          timePriority[firstJob.timePreference || "asap"] -
          timePriority[secondJob.timePreference || "asap"];
        if (priorityDifference !== 0) return priorityDifference;

        if (firstJob.timePreference === "specific" && secondJob.timePreference === "specific") {
          const firstDate = `${firstJob.requestedDate || "9999-12-31"}T${firstJob.requestedTime || "23:59:59"}`;
          const secondDate = `${secondJob.requestedDate || "9999-12-31"}T${secondJob.requestedTime || "23:59:59"}`;
          return Date.parse(firstDate) - Date.parse(secondDate);
        }

        return (Date.parse(secondJob.createdAt || "") || 0) - (Date.parse(firstJob.createdAt || "") || 0);
      });
  }, [jobs, mobilityFilter, sortOption, timeFilter, vehicleFilter]);

  return {
    timeFilter,
    setTimeFilter,
    vehicleFilter,
    setVehicleFilter,
    mobilityFilter,
    setMobilityFilter,
    sortOption,
    setSortOption,
    showAdvancedFilters,
    setShowAdvancedFilters,
    filteredJobs,
  };
}
