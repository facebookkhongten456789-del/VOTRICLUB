/**
 * Nhãn & style trạng thái Fanpage (frontend)
 */
(function () {
    const LABELS = {
        Active: 'Hoạt động',
        Inactive: 'Không hoạt động',
        Die: 'DIE',
        Restricted: 'Hạn chế',
    };

    function pageStatusLabel(status) {
        return LABELS[status] || String(status || '');
    }

    function statusPillClass(status) {
        if (status === 'Active') return 'status-active';
        if (status === 'Restricted') return 'status-restricted';
        return 'status-inactive';
    }

    window.PageStatus = {
        LABELS,
        pageStatusLabel,
        statusPillClass,
    };
})();
