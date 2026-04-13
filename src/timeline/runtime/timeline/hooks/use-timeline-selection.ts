import { useEffect, useMemo, useState } from "react";

import type {
  TimelineCategoryBucket,
  TimelineCategoryDetail,
  TimelineDashboardData,
  TimelineRangeAggregate,
  TimelineRangeKey,
  TimelineSubcategoryBucket,
  TimelineSubcategoryDetail,
  TimelineView,
} from "../../contracts";
import { buildMonthTimeline, buildScaledDepthColor } from "../lib/dashboard-helpers";

interface StyledSubcategoryBucket extends TimelineSubcategoryBucket {
  shadeColor: string;
}

interface UseTimelineSelectionArgs {
  data: TimelineDashboardData;
  range: TimelineRangeKey;
  selectedDate: string;
  selectedMonth: string;
  selectedWeek: string;
}

function useTimelineSelection({
  data,
  range,
  selectedDate,
  selectedMonth,
  selectedWeek,
}: UseTimelineSelectionArgs) {
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState("");

  const currentKey = range === "day" ? selectedDate : range === "week" ? selectedWeek : selectedMonth;
  const currentAggregate: TimelineRangeAggregate | null = data?.ranges?.[range]?.[currentKey] || null;
  const currentTimeline = useMemo<TimelineView | null>(() => {
    if (range === "day") {
      return data?.timelines?.day?.[selectedDate] || null;
    }
    if (range === "week") {
      return data?.timelines?.week?.[selectedWeek] || null;
    }
    return buildMonthTimeline(data, selectedMonth);
  }, [data, range, selectedDate, selectedWeek, selectedMonth]);

  const categories: TimelineCategoryBucket[] = currentAggregate?.categories || [];

  useEffect(() => {
    setSelectedCategoryId("");
    setSelectedSubcategoryId("");
  }, [range, currentKey]);

  useEffect(() => {
    if (!categories.length) {
      setSelectedCategoryId("");
      return;
    }
    const defaultCategoryId = categories.some((item) => item.categoryId === "life")
      ? "life"
      : (categories[0]?.categoryId || "");
    if (!selectedCategoryId || !categories.some((item) => item.categoryId === selectedCategoryId)) {
      setSelectedCategoryId(defaultCategoryId);
    }
  }, [categories, selectedCategoryId]);

  const categoryDetail: TimelineCategoryDetail | null = currentAggregate?.categoryDetails?.[selectedCategoryId] || null;
  const subcategoryDetail: TimelineSubcategoryDetail | null = currentAggregate?.subcategoryDetails?.[selectedSubcategoryId] || null;
  const subcategories: TimelineSubcategoryBucket[] = categoryDetail?.subcategories || [];
  const styledSubcategories = useMemo<StyledSubcategoryBucket[]>(() => {
    const maxMinutes = Math.max(...subcategories.map((item) => Number(item.minutes || 0)), 1);
    return subcategories.map((subcategory) => ({
      ...subcategory,
      shadeColor: buildScaledDepthColor(subcategory.color, Number(subcategory.minutes || 0) / maxMinutes),
    }));
  }, [subcategories]);

  useEffect(() => {
    if (!styledSubcategories.length) {
      setSelectedSubcategoryId("");
      return;
    }
    if (selectedSubcategoryId && !styledSubcategories.some((item) => item.subcategoryId === selectedSubcategoryId)) {
      setSelectedSubcategoryId("");
    }
  }, [selectedSubcategoryId, styledSubcategories]);

  const activeDetail = subcategoryDetail && subcategoryDetail.categoryId === selectedCategoryId
    ? subcategoryDetail
    : categoryDetail;
  const currentTimelineItemCount = Array.isArray(currentTimeline?.items) ? currentTimeline.items.length : 0;

  const selectCategory = (categoryId: string) => {
    setSelectedCategoryId(categoryId);
    setSelectedSubcategoryId("");
  };

  const selectSubcategory = (subcategoryId: string) => {
    setSelectedSubcategoryId(subcategoryId);
  };

  return {
    activeDetail,
    categories,
    categoryDetail,
    currentAggregate,
    currentKey,
    currentTimeline,
    currentTimelineItemCount,
    selectedCategoryId,
    selectedSubcategoryId,
    selectCategory,
    selectSubcategory,
    styledSubcategories,
  };
}

export { useTimelineSelection };
