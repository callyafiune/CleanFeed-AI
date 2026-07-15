export interface PostViewportChange {
  element: HTMLElement;
  nearViewport: boolean;
}

export interface PostIntersectionObserver {
  observe(element: HTMLElement): void;
  unobserve(element: HTMLElement): void;
  disconnect(): void;
}

export function createPostIntersectionObserver(
  callback: (changes: PostViewportChange[]) => void,
): PostIntersectionObserver {
  const observer = new IntersectionObserver(
    (entries) => {
      const changes = entries.flatMap((entry) =>
        entry.target instanceof HTMLElement
          ? [
              {
                element: entry.target,
                nearViewport: entry.isIntersecting,
              },
            ]
          : [],
      );

      if (changes.length > 0) callback(changes);
    },
    {
      root: null,
      rootMargin: "500px",
      threshold: 0.01,
    },
  );

  return {
    observe(element) {
      observer.observe(element);
    },
    unobserve(element) {
      observer.unobserve(element);
    },
    disconnect() {
      observer.disconnect();
    },
  };
}
