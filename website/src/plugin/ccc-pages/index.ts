import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { LoadContext, Plugin } from '@docusaurus/types';
import { Release, Control, Feature, Component, ReleasePageData, Threat, ControlPageData, FeaturePageData, ThreatPageData, HomePageData, ComponentPageData } from '@site/src/types/ccc';
import { PageCreator } from './PageCreator';

interface CCCReleaseYaml {
    metadata: {
        title: string;
        id: string;
        description: string;
        release_details: any[];
    };
    controls: any[];
    features: any[];
    threats: any[];
}

type PluginContent = CCCReleaseYaml[];

function parseRelease(parsed: CCCReleaseYaml): Release {
    const slug = `/ccc/${parsed.metadata.id}/${parsed.metadata.release_details[0]?.version || 'N/A'}`;
    return {
        metadata: parsed.metadata,
        threats: parsed.threats.map(threat => parseThreat(threat, slug)),
        features: parsed.features.map(feature => parseFeature(feature, slug)),
        controls: parsed.controls.map(control => parseControl(control, slug)),
        slug,
    };
}

function parseThreat(threat: any, slug: string): Threat {
    return {
        ...threat,
        slug: slug + "/" + threat.id,
    };
}

function parseFeature(feature: any, slug: string): Feature {
    return {
        ...feature,
        slug: slug + "/" + feature.id,
    };
}

function parseControl(control: any, slug: string): Control {
    return {
        ...control,
        slug: slug + "/" + control.id,
    };
}

function createControlPageData(control: Control, release: Release): ControlPageData {
    const relatedThreats = control.threats?.map(threatId => release.threats.find(t => t.id === threatId)
    ).filter(Boolean) || [];

    return {
        control: {
            ...control,
            related_threats: relatedThreats,
        },
        releaseTitle: release.metadata.title,
        releaseSlug: release.slug,
    };
}

function createFeaturePageData(feature: Feature, release: Release): FeaturePageData {
    // Find all threats that reference this feature
    const relatedThreats = release.threats.filter(threat => threat.features.includes(feature.id))

    return {
        feature: {
            ...feature,
            related_threats: relatedThreats
        },
        releaseTitle: release.metadata.title,
        releaseSlug: release.slug,
    };
}

function createThreatPageData(threat: Threat, release: Release): ThreatPageData {
    const relatedControls = release.controls.filter(control => control.threats.includes(threat.id))

    const relatedFeatures = threat.features?.map(featureId => release.features.find(f => f.id === featureId)
    ).filter(Boolean) || [];

    return {
        threat: {
            ...threat,
            related_controls: relatedControls,
            related_features: relatedFeatures
        },
        releaseTitle: release.metadata.title,
        releaseSlug: release.slug,
    };
}

function createComponentPageData(component: Component): ComponentPageData {
    return {
        component: component,
        releaseTitle: component.releases[0].metadata.title,
        releaseSlug: component.releases[0].slug,
    };
}

export default function pluginCCCPages(_: LoadContext): Plugin<PluginContent> {
    return {
        name: 'ccc-pages',

        async loadContent(): Promise<PluginContent> {
            const dataDir = path.resolve(__dirname, '../../data/ccc-releases');
            const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.yaml'));

            return files.map((file) => {
                const filePath = path.join(dataDir, file);
                const raw = fs.readFileSync(filePath, 'utf8');
                return yaml.load(raw) as CCCReleaseYaml;
            });
        },

        async contentLoaded({ actions, content }) {
            const { setGlobalData, createData, addRoute } = actions;
            const pageCreator: PageCreator = new PageCreator(createData, addRoute);
            const cccReleases: Release[] = [];

            // Group releases by component
            const components: Record<string, Component> = {};

            for (const parsed of content) {
                const release = parseRelease(parsed);
                cccReleases.push(release);

                const componentId = release.metadata.id;
                if (!components[componentId]) {
                    components[componentId] = {title: release.metadata.title, releases: [], slug: `/ccc/${componentId}`};
                }

                components[componentId].releases.push(release);

                const cccReleasePageData: ReleasePageData = {
                    release,
                    releaseTitle: release.metadata.title,
                    releaseSlug: release.slug,
                };

                await pageCreator.createPage(cccReleasePageData, release.slug, '@site/src/components/ccc/Release/index.tsx');

                for (const control of release.controls) {
                    const pageData: ControlPageData = createControlPageData(control, release);
                    await pageCreator.createPage(pageData, `${pageData.control.slug}`, '@site/src/components/ccc/Control/index.tsx');
                }

                for (const feature of release.features || []) {
                    const pageData: FeaturePageData = createFeaturePageData(feature, release);
                    await pageCreator.createPage(pageData, `${pageData.feature.slug}`, '@site/src/components/ccc/Feature/index.tsx');
                }

                for (const threat of release.threats || []) {
                    const pageData: ThreatPageData = createThreatPageData(threat, release);
                    pageCreator.createPage(pageData, `${pageData.threat.slug}`, '@site/src/components/ccc/Threat/index.tsx');
                }
            }

            Object.entries(components).forEach(([componentId, component]) => {
                component.releases.sort((a, b) => b.metadata.release_details[0].version.localeCompare(a.metadata.release_details[0].version));
                const componentPageData: ComponentPageData = createComponentPageData(component);
                pageCreator.createPage(componentPageData, `/ccc/${componentId}`, '@site/src/components/ccc/Component/index.tsx');
            });

            const homePageData: HomePageData = {
                components: Object.entries(components).flatMap(([_, component]) => component),
            };

            await pageCreator.createPage(homePageData, '/ccc', '@site/src/components/ccc/Home/index.tsx');

            setGlobalData({
                'ccc-releases': cccReleases,
                'ccc-release-yaml': content
            });
        },
    };
}
