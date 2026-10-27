import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, animate } from 'framer-motion';
import { Check, X } from 'lucide-react';
import type { UnifiedSong } from '../../../../types';
import { formatTime } from '../../../../utils/appPlaybackHelpers';
import './LatticeBilibiliPartsPopup.css';

interface LatticeBilibiliPartsPopupProps {
    title: string;
    tracks: UnifiedSong[];
    currentCid: number;
    anchorElement: HTMLElement | null;
    onSelectPart: (song: UnifiedSong) => void;
    onClose: () => void;
}

export const LatticeBilibiliPartsPopup: React.FC<LatticeBilibiliPartsPopupProps> = ({
    title,
    tracks,
    currentCid,
    anchorElement,
    onSelectPart,
    onClose,
}) => {
    const listRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [popupCoords, setPopupCoords] = useState<{ top: number; left: number } | null>(null);
    const initialCenterRef = useRef<{ x: number; y: number } | null>(null);

    // 惯性滚动动画句柄
    const inertiaAnimationRef = useRef<{ stop: () => void } | null>(null);

    // 鼠标拖拽平移及甩动（惯性）状态
    const dragRef = useRef<{
        isDragging: boolean;
        startY: number;
        startScrollTop: number;
        hasMoved: boolean;
        lastY: number;
        lastTime: number;
        velocity: number; // px/s
    }>({
        isDragging: false,
        startY: 0,
        startScrollTop: 0,
        hasMoved: false,
        lastY: 0,
        lastTime: 0,
        velocity: 0,
    });

    // 动态跟踪卡片位置：若划出屏幕中心一段区域后自动关闭
    useEffect(() => {
        if (!anchorElement) return;

        const updatePositionAndCheckDistance = () => {
            const poster = anchorElement.closest('.lattice-poster');
            const card = (poster as HTMLElement) || anchorElement;
            const rect = card.getBoundingClientRect();
            const currentCenterX = rect.left + rect.width / 2;
            const currentCenterY = rect.top + rect.height / 2;

            if (!initialCenterRef.current) {
                initialCenterRef.current = { x: currentCenterX, y: currentCenterY };
            } else {
                const dx = currentCenterX - initialCenterRef.current.x;
                const dy = currentCenterY - initialCenterRef.current.y;
                const distance = Math.hypot(dx, dy);

                // 当正在播放的卡片被拖动/平移划出超过 200px 时，自动关闭分P选择窗口
                if (distance > 200) {
                    onClose();
                    return;
                }
            }

            // 更新跟随锚点按钮的绝对坐标
            const btnRect = anchorElement.getBoundingClientRect();
            const width = 320;
            const margin = 12;
            let left = Math.round(btnRect.right - width);
            if (left < margin) left = margin;
            if (left + width > window.innerWidth - margin) {
                left = window.innerWidth - margin - width;
            }
            const top = Math.round(btnRect.top - margin);
            setPopupCoords(current => {
                if (current && Math.abs(current.top - top) < 1 && Math.abs(current.left - left) < 1) {
                    return current;
                }
                return { top, left };
            });
        };

        updatePositionAndCheckDistance();

        // 用 requestAnimationFrame 持续在墙面动画或拖拽期间跟踪
        let animationFrameId: number;
        const tick = () => {
            updatePositionAndCheckDistance();
            animationFrameId = requestAnimationFrame(tick);
        };
        animationFrameId = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [anchorElement, onClose]);

    // 滚轮事件隔离：阻止冒泡并自己滚动
    useEffect(() => {
        const elem = listRef.current;
        if (!elem) return;

        const handleWheel = (e: WheelEvent) => {
            // 中断正在进行的惯性滚动
            if (inertiaAnimationRef.current) {
                inertiaAnimationRef.current.stop();
                inertiaAnimationRef.current = null;
            }

            // 阻止继续向外冒泡给 Lattice 墙面的手势监听
            e.stopPropagation();
            e.preventDefault();

            const scrollContainer = scrollContainerRef.current;
            if (scrollContainer) {
                scrollContainer.scrollTop += e.deltaY;
            }
        };

        elem.addEventListener('wheel', handleWheel, { passive: false, capture: true });
        return () => {
            elem.removeEventListener('wheel', handleWheel, { capture: true });
        };
    }, []);

    // 鼠标点击拖动上下滚动 + 甩动惯性效果（Fling / Inertia Scroll）
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const onPointerDown = (e: PointerEvent) => {
            // 仅鼠标左键触发拖拽
            if (e.button !== 0) return;

            // 停止之前的惯性滑行
            if (inertiaAnimationRef.current) {
                inertiaAnimationRef.current.stop();
                inertiaAnimationRef.current = null;
            }

            dragRef.current = {
                isDragging: true,
                startY: e.clientY,
                startScrollTop: container.scrollTop,
                hasMoved: false,
                lastY: e.clientY,
                lastTime: performance.now(),
                velocity: 0,
            };
            container.classList.add('is-pointer-dragging');
        };

        const onPointerMove = (e: PointerEvent) => {
            if (!dragRef.current.isDragging) return;
            const now = performance.now();
            const dt = now - dragRef.current.lastTime;
            const deltaY = e.clientY - dragRef.current.startY;
            const dy = e.clientY - dragRef.current.lastY;

            if (Math.abs(deltaY) > 3) {
                dragRef.current.hasMoved = true;
            }

            // 计算平滑后的瞬时速度（px/s）
            if (dt > 8) {
                const currentV = (dy / dt) * 1000;
                dragRef.current.velocity = dragRef.current.velocity * 0.4 + currentV * 0.6;
                dragRef.current.lastY = e.clientY;
                dragRef.current.lastTime = now;
            }

            container.scrollTop = dragRef.current.startScrollTop - deltaY;
        };

        const onPointerUp = () => {
            if (!dragRef.current.isDragging) return;
            dragRef.current.isDragging = false;
            container.classList.remove('is-pointer-dragging');

            const now = performance.now();
            const timeSinceLastMove = now - dragRef.current.lastTime;

            // 如果松开前停顿超过 80ms，视作定点松开，不触发甩动惯性
            if (timeSinceLastMove > 80) return;

            // 向上甩 dy < 0，scrollTop 需要增加；向下甩 dy > 0，scrollTop 需要减少
            // 速度转换为针对 scrollTop 的初始速度 (px/s)
            const initialScrollVelocity = -dragRef.current.velocity;
            const speed = Math.abs(initialScrollVelocity);

            if (speed > 80) {
                const startScroll = container.scrollTop;
                const cappedSpeed = Math.min(speed, 5000);
                const signedVelocity = Math.sign(initialScrollVelocity) * cappedSpeed;

                const anim = animate(0, signedVelocity * 0.4, {
                    type: 'inertia',
                    velocity: signedVelocity,
                    power: 0.4,
                    timeConstant: 320,
                    restDelta: 0.5,
                    onUpdate: offset => {
                        container.scrollTop = startScroll + offset;
                    },
                    onComplete: () => {
                        inertiaAnimationRef.current = null;
                    },
                });
                inertiaAnimationRef.current = anim;
            }
        };

        container.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);

        return () => {
            if (inertiaAnimationRef.current) {
                inertiaAnimationRef.current.stop();
                inertiaAnimationRef.current = null;
            }
            container.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        };
    }, []);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (listRef.current && !listRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        };

        document.addEventListener('pointerdown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    // 打开时自动滚动到当前播放的分P
    useEffect(() => {
        if (!scrollContainerRef.current) return;
        const activeElem = scrollContainerRef.current.querySelector('.is-current');
        if (activeElem) {
            activeElem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [currentCid]);

    const popupContent = (
        <motion.div
            ref={listRef}
            className="lattice-bilibili-parts-popup"
            role="dialog"
            aria-label="选择分P"
            style={
                popupCoords
                    ? {
                          position: 'fixed',
                          left: `${popupCoords.left}px`,
                          bottom: `${window.innerHeight - popupCoords.top}px`,
                          transformOrigin: 'bottom right',
                      }
                    : undefined
            }
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={e => e.stopPropagation()}
        >
            <div className="lattice-bilibili-parts-header">
                <span className="lattice-bilibili-parts-title" title={title}>
                    分P选集 · {tracks.length}P
                </span>
                <button
                    type="button"
                    className="lattice-bilibili-parts-close"
                    onClick={onClose}
                    aria-label="关闭"
                    title="关闭"
                >
                    <X size={15} />
                </button>
            </div>
            <div ref={scrollContainerRef} className="lattice-bilibili-parts-list" role="listbox">
                {tracks.map((song, index) => {
                    const cid = Number((song.sourceRef as any)?.providerData?.cid || 0);
                    const pageNum = Number((song.sourceRef as any)?.providerData?.page || index + 1);
                    const isCurrent = currentCid ? cid === currentCid : index === 0;
                    return (
                        <button
                            key={song.id}
                            type="button"
                            role="option"
                            aria-selected={isCurrent}
                            className={`lattice-bilibili-parts-item ${isCurrent ? 'is-current' : ''}`}
                            onClick={() => {
                                // 如果在拖拽或甩动释放时触发，不认为是原地点按
                                if (dragRef.current.hasMoved) return;
                                onSelectPart(song);
                                onClose();
                            }}
                        >
                            <span className="lattice-bilibili-parts-index">P{pageNum}</span>
                            <span className="lattice-bilibili-parts-name" title={song.name}>
                                {song.name}
                            </span>
                            <span className="lattice-bilibili-parts-duration">
                                {formatTime((song.durationMs || 0) / 1000)}
                            </span>
                            {isCurrent && (
                                <span className="lattice-bilibili-parts-check">
                                    <Check size={14} />
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </motion.div>
    );

    return createPortal(popupContent, document.body);
};
