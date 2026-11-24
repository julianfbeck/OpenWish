plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    `maven-publish`
}

// JitPack sets VERSION to the git tag (v1.2.0); local builds use gradle.properties.
val openwishVersion: String = System.getenv("VERSION")?.takeIf { it.isNotBlank() }
    ?: providers.gradleProperty("openwishVersion").orNull
    ?: "1.2.0-SNAPSHOT"

group = "com.github.julianfbeck"
version = openwishVersion

android {
    namespace = "com.openwish.android"
    compileSdk = 36

    defaultConfig {
        minSdk = 29
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures { compose = true }
    publishing {
        singleVariant("release") { withSourcesJar() }
    }
}

dependencies {
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.kotlinx.coroutines.android)
    // Public API types: JsonObject (issue context, cards) and OkHttpClient (configuration).
    api(libs.kotlinx.serialization.json)
    api(libs.okhttp)

    testImplementation(libs.junit)
}

publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = "com.github.julianfbeck"
            artifactId = "OpenWish"
            version = openwishVersion
            afterEvaluate { from(components["release"]) }
            pom {
                name.set("OpenWish Android")
                description.set("Feature requests, bug reports and replies for Android apps (Jetpack Compose).")
                url.set("https://github.com/julianfbeck/OpenWish")
            }
        }
    }
}
