import dayjs from "https://cdn.jsdelivr.net/npm/dayjs@1/+esm";
import updateLocale from "https://cdn.jsdelivr.net/npm/dayjs@1/plugin/updateLocale.js/+esm";
import "https://cdn.jsdelivr.net/npm/dayjs@1/locale/pl.js/+esm";

dayjs.extend(updateLocale);

const MONTHS_STANDALONE = [
    "styczeń",
    "luty",
    "marzec",
    "kwiecień",
    "maj",
    "czerwiec",
    "lipiec",
    "sierpień",
    "wrzesień",
    "październik",
    "listopad",
    "grudzień"
];

const MONTHS_GENITIVE = [
    "stycznia",
    "lutego",
    "marca",
    "kwietnia",
    "maja",
    "czerwca",
    "lipca",
    "sierpnia",
    "września",
    "października",
    "listopada",
    "grudnia"
];

dayjs.updateLocale("pl", {
    months: (instance, format = "") => {
        const month = instance.month();
        return /D\s+MMMM/.test(format) ? MONTHS_GENITIVE[month] : MONTHS_STANDALONE[month];
    }
});

dayjs.locale("pl");

export { dayjs };

export function today() {
    return dayjs();
}

export function lastDayPrevMonth(base = dayjs()) {
    return base.startOf("month").subtract(1, "day");
}

export function addDays(dateValue, days) {
    return dayjs(dateValue).add(days, "day");
}

export function toIsoDate(dateValue) {
    return dayjs(dateValue).format("YYYY-MM-DD");
}

export function formatPeriodLabel(dateValue) {
    return `za ${dayjs(dateValue).format("MMMM YYYY")}`;
}