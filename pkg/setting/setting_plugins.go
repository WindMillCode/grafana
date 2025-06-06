package setting

import (
	"strings"

	"gopkg.in/ini.v1"

	"github.com/grafana/grafana/pkg/util"
)

const (
	PluginUpdateStrategyLatest = "latest"
	PluginUpdateStrategyMinor  = "minor"
)

// PluginSettings maps plugin id to map of key/value settings.
type PluginSettings map[string]map[string]string

func extractPluginSettings(sections []*ini.Section) PluginSettings {
	psMap := PluginSettings{}
	for _, section := range sections {
		sectionName := section.Name()
		if !strings.HasPrefix(sectionName, "plugin.") {
			continue
		}

		pluginID := strings.Replace(sectionName, "plugin.", "", 1)
		psMap[pluginID] = section.KeysHash()
	}

	return psMap
}

var (
	defaultPreinstallPlugins = map[string]InstallPlugin{
		// Default preinstalled plugins
		"grafana-lokiexplore-app":      {"grafana-lokiexplore-app", "", ""},
		"grafana-pyroscope-app":        {"grafana-pyroscope-app", "", ""},
		"grafana-exploretraces-app":    {"grafana-exploretraces-app", "", ""},
		"grafana-metricsdrilldown-app": {"grafana-metricsdrilldown-app", "", ""},
	}
)

func (cfg *Cfg) processPreinstallPlugins(rawInstallPlugins []string, preinstallPlugins map[string]InstallPlugin) {
	// Add the plugins defined in the configuration
	for _, plugin := range rawInstallPlugins {
		parts := strings.Split(plugin, "@")
		id := parts[0]
		version := ""
		url := ""
		if len(parts) > 1 {
			version = parts[1]
			if len(parts) > 2 {
				url = parts[2]
			}
		}

		preinstallPlugins[id] = InstallPlugin{id, version, url}
	}
}

func (cfg *Cfg) readPluginSettings(iniFile *ini.File) error {
	pluginsSection := iniFile.Section("plugins")

	cfg.PluginsEnableAlpha = pluginsSection.Key("enable_alpha").MustBool(false)
	cfg.PluginsAppsSkipVerifyTLS = pluginsSection.Key("app_tls_skip_verify_insecure").MustBool(false)
	cfg.PluginSettings = extractPluginSettings(iniFile.Sections())
	cfg.PluginSkipPublicKeyDownload = pluginsSection.Key("public_key_retrieval_disabled").MustBool(false)
	cfg.PluginForcePublicKeyDownload = pluginsSection.Key("public_key_retrieval_on_startup").MustBool(false)

	cfg.PluginsAllowUnsigned = util.SplitString(pluginsSection.Key("allow_loading_unsigned_plugins").MustString(""))
	cfg.DisablePlugins = util.SplitString(pluginsSection.Key("disable_plugins").MustString(""))
	cfg.HideAngularDeprecation = util.SplitString(pluginsSection.Key("hide_angular_deprecation").MustString(""))
	cfg.ForwardHostEnvVars = util.SplitString(pluginsSection.Key("forward_host_env_vars").MustString(""))
	disablePreinstall := pluginsSection.Key("preinstall_disabled").MustBool(false)
	if !disablePreinstall {
		rawInstallPluginsAsync := util.SplitString(pluginsSection.Key("preinstall").MustString(""))
		preinstallPluginsAsync := make(map[string]InstallPlugin)
		// Add the default preinstalled plugins to pre install plugins async list
		for _, plugin := range defaultPreinstallPlugins {
			preinstallPluginsAsync[plugin.ID] = plugin
		}
		if cfg.IsFeatureToggleEnabled("grafanaAdvisor") { // Use literal string to avoid circular dependency
			preinstallPluginsAsync["grafana-advisor-app"] = InstallPlugin{"grafana-advisor-app", "", ""}
		}
		cfg.processPreinstallPlugins(rawInstallPluginsAsync, preinstallPluginsAsync)

		rawInstallPluginsSync := util.SplitString(pluginsSection.Key("preinstall_sync").MustString(""))
		preinstallPluginsSync := make(map[string]InstallPlugin)
		cfg.processPreinstallPlugins(rawInstallPluginsSync, preinstallPluginsSync)
		// Remove from the list the plugins that have been disabled
		for _, disabledPlugin := range cfg.DisablePlugins {
			delete(preinstallPluginsAsync, disabledPlugin)
			delete(preinstallPluginsSync, disabledPlugin)
		}
		for _, plugin := range preinstallPluginsAsync {
			cfg.PreinstallPluginsAsync = append(cfg.PreinstallPluginsAsync, plugin)
		}

		for _, plugin := range preinstallPluginsSync {
			cfg.PreinstallPluginsSync = append(cfg.PreinstallPluginsSync, plugin)
		}
		installPluginsInAsync := pluginsSection.Key("preinstall_async").MustBool(true)
		if !installPluginsInAsync {
			for key, plugin := range preinstallPluginsAsync {
				if _, exists := preinstallPluginsSync[key]; !exists {
					cfg.PreinstallPluginsSync = append(cfg.PreinstallPluginsSync, plugin)
				}
			}
			cfg.PreinstallPluginsAsync = nil
		}
	}

	cfg.PluginCatalogURL = pluginsSection.Key("plugin_catalog_url").MustString("https://grafana.com/grafana/plugins/")
	cfg.PluginAdminEnabled = pluginsSection.Key("plugin_admin_enabled").MustBool(true)
	cfg.PluginAdminExternalManageEnabled = pluginsSection.Key("plugin_admin_external_manage_enabled").MustBool(false)
	cfg.PluginCatalogHiddenPlugins = util.SplitString(pluginsSection.Key("plugin_catalog_hidden_plugins").MustString(""))

	// Pull disabled plugins from the catalog
	cfg.PluginCatalogHiddenPlugins = append(cfg.PluginCatalogHiddenPlugins, cfg.DisablePlugins...)

	// Plugins CDN settings
	cfg.PluginsCDNURLTemplate = strings.TrimRight(pluginsSection.Key("cdn_base_url").MustString(""), "/")
	cfg.PluginLogBackendRequests = pluginsSection.Key("log_backend_requests").MustBool(false)

	cfg.PluginUpdateStrategy = pluginsSection.Key("update_strategy").In(PluginUpdateStrategyLatest, []string{PluginUpdateStrategyLatest, PluginUpdateStrategyMinor})

	return nil
}
